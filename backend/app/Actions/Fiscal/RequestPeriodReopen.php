<?php

declare(strict_types=1);

namespace App\Actions\Fiscal;

use App\Contracts\IdGenerator;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Fiscal\ReopenRequestStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fiscal\FiscalYear;
use App\Models\Fiscal\PeriodReopenRequest;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Asks to reopen a closed period (PRD §4: two approvers and a reason). Once the year has been
 * closed, corrections go into its adjustment period instead (D7), so its periods stay closed.
 */
final class RequestPeriodReopen
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly FiscalGuard $guard,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, string $periodId, string $reason): PeriodReopenRequest
    {
        if (trim($reason) === '') {
            throw DomainRuleViolation::single('reason_required', 'Say why the period has to be reopened.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $periodId, $reason) {
            $period = $this->guard->lockPeriod($locks, $periodId);
            $this->guard->require($actor, 'periods.reopen.request', $period->company_id);
            if ($period->status !== PeriodStatus::Closed) {
                throw DomainRuleViolation::single('period_not_closed', "Only a closed period can be reopened; this one is {$period->status->value}.");
            }
            $year = FiscalYear::query()->findOrFail($period->fiscal_year_id);
            if ($year->status !== 'open') {
                throw DomainRuleViolation::single('fiscal_year_closed', 'The year has been closed; post corrections into its adjustment period.');
            }
            if (PeriodReopenRequest::query()->where('fiscal_period_id', $period->id)->where('status', ReopenRequestStatus::Pending)->exists()) {
                throw DomainRuleViolation::single('reopen_already_requested', 'A reopen request for this period is already waiting.');
            }

            $request = new PeriodReopenRequest;
            $request->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $period->company_id,
                'fiscal_period_id' => $period->id, 'requested_by' => $actor->id, 'reason' => trim($reason),
                'status' => ReopenRequestStatus::Pending,
            ])->save();
            $audit->add('period.reopen_requested', $request, after: $request);

            return $request;
        });
    }
}
