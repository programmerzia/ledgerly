<?php

declare(strict_types=1);

namespace App\Actions\Fiscal;

use App\Actions\Fiscal\Inputs\ClosePeriodInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Contracts\PeriodCloseCheck;
use App\Domain\Fiscal\CheckOutcome;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Events\Fiscal\PeriodClosed;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\PeriodCloseCheck as CheckRow;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Contracts\Container\Container;

/**
 * open | soft_closed → closed (13 §8, §10). The period is locked FOR UPDATE first, so in-flight
 * postings finish and are seen by the checks, and postings waiting behind the lock then fail
 * `period_closed`. A failing check blocks the close unless it is waived with a reason; every
 * outcome is stored in `period_close_checks`. Needs a signing grant (ADR-0004).
 */
final class ClosePeriod
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly FiscalGuard $guard,
        private readonly Container $container,
        private readonly Clock $clock,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, ClosePeriodInput $in): FiscalPeriod
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $period = $this->guard->lockPeriod($locks, $in->periodId);
            $this->guard->require($actor, 'periods.close', $period->company_id, signed: true);
            if (! in_array($period->status, [PeriodStatus::Open, PeriodStatus::SoftClosed], true)) {
                throw DomainRuleViolation::single('period_already_closed', "The period is already {$period->status->value}.");
            }

            $now = $this->clock->now();
            $blocking = [];
            $results = [];
            foreach ($this->checks() as $check) {
                $outcome = $check->run($period);
                $reason = trim($in->waivers[$outcome->code] ?? '');
                $status = $outcome->passed ? 'pass' : ($reason !== '' ? 'waived' : 'fail');
                if ($status === 'fail') {
                    $blocking[] = new Violation('close_check_failed', "{$outcome->code}: {$outcome->message}");
                }
                $this->store($actor, $period, $outcome, $status, $status === 'waived' ? $reason : null, $now);
                $results[$outcome->code] = $status;
            }
            if ($blocking !== []) {
                // Stored check rows roll back with the refusal; the client re-runs the checklist to show them.
                throw new DomainRuleViolation('period_checks_failed', 'Fix or waive the failing checks before closing.', $blocking);
            }

            $before = $period->attributesToArray();
            $period->forceFill(['status' => PeriodStatus::Closed, 'closed_at' => $now, 'closed_by' => $actor->id])->save();
            $audit->add('period.closed', $period, before: $before, after: $period, context: ['checks' => $results, 'waivers' => $in->waivers ?: null]);
            $outbox->add(new PeriodClosed($period->company_id, $period->id));

            return $period;
        });
    }

    /** @return list<PeriodCloseCheck> */
    private function checks(): array
    {
        /** @var list<class-string<PeriodCloseCheck>> $classes */
        $classes = (array) config('period_close.checks', []);

        return array_map(fn (string $class): PeriodCloseCheck => $this->container->make($class), $classes);
    }

    private function store(Actor $actor, FiscalPeriod $period, CheckOutcome $outcome, string $status, ?string $reason, \DateTimeImmutable $now): void
    {
        $row = CheckRow::query()->where('fiscal_period_id', $period->id)->where('check_code', $outcome->code)->first() ?? new CheckRow;
        $row->forceFill([
            'id' => $row->exists ? $row->id : $this->ids->next(),
            'tenant_id' => $actor->tenantId, 'company_id' => $period->company_id, 'fiscal_period_id' => $period->id,
            'check_code' => $outcome->code, 'status' => $status, 'detail' => ['message' => $outcome->message, ...$outcome->detail],
            'checked_at' => $now, 'waived_by' => $status === 'waived' ? $actor->id : null, 'waived_reason' => $reason,
        ])->save();
    }
}
