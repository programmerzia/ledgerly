<?php

declare(strict_types=1);

namespace App\Actions\Fiscal;

use App\Contracts\Clock;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Fiscal\PeriodSoftClosed;
use App\Models\Fiscal\FiscalPeriod;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** open → soft_closed (PRD §4, D5): from now on only holders of periods.post_soft_closed post here. */
final class SoftClosePeriod
{
    public function __construct(private readonly UnitOfWork $uow, private readonly FiscalGuard $guard, private readonly Clock $clock) {}

    public function handle(Actor $actor, string $periodId): FiscalPeriod
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $periodId) {
            $period = $this->guard->lockPeriod($locks, $periodId);
            $this->guard->require($actor, 'periods.close', $period->company_id);
            if ($period->status !== PeriodStatus::Open) {
                throw DomainRuleViolation::single('period_not_open', "Only an open period can be soft-closed; this one is {$period->status->value}.");
            }
            $before = $period->attributesToArray();
            $period->forceFill(['status' => PeriodStatus::SoftClosed, 'soft_closed_at' => $this->clock->now()])->save();
            $audit->add('period.soft_closed', $period, before: $before, after: $period);
            $outbox->add(new PeriodSoftClosed($period->company_id, $period->id));

            return $period;
        });
    }
}
