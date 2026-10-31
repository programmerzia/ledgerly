<?php

declare(strict_types=1);

namespace App\Actions\Fiscal;

use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Fiscal\FiscalYearLocked;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Final (D7): every period of the year, the adjustment period included, closed → locked. Signed. */
final class LockFiscalYear
{
    public function __construct(private readonly UnitOfWork $uow, private readonly FiscalGuard $guard) {}

    public function handle(Actor $actor, string $fiscalYearId): FiscalYear
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $fiscalYearId) {
            $year = FiscalYear::query()->find($fiscalYearId) ?? throw DomainRuleViolation::single('not_found', 'The fiscal year does not exist.');
            $this->guard->require($actor, 'periods.year_end', $year->company_id, signed: true);
            $ids = array_values(array_map(strval(...), FiscalPeriod::query()->where('fiscal_year_id', $year->id)->pluck('id')->all()));
            $periods = $locks->periodsById($year->company_id, $ids, forUpdate: true);
            $year = FiscalYear::query()->whereKey($year->id)->lockForUpdate()->firstOrFail();

            if ($year->status === 'locked') {
                throw DomainRuleViolation::single('fiscal_year_locked', 'The year is already locked.');
            }
            if ($year->status !== 'closed') {
                throw DomainRuleViolation::single('fiscal_year_not_closed', 'Run the year-end close before locking the year.');
            }
            $open = array_values(array_filter($periods, fn (FiscalPeriod $p) => $p->status !== PeriodStatus::Closed));
            if ($open !== []) {
                throw DomainRuleViolation::single('periods_not_closed', 'Close every period first, the adjustment period included: '.implode(', ', array_map(fn ($p) => $p->name, $open)).'.');
            }

            foreach ($periods as $period) {
                $period->forceFill(['status' => PeriodStatus::Locked])->save();
            }
            $before = $year->attributesToArray();
            $year->forceFill(['status' => 'locked'])->save();
            $audit->add('fiscal_year.locked', $year, before: $before, after: $year);
            $outbox->add(new FiscalYearLocked($year->company_id, $year->id));

            return $year;
        });
    }
}
