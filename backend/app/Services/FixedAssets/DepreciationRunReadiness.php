<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\Violation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\FixedAssets\DepreciationRun;

/** What would stop a depreciation run from posting now: submit asks this early, and posting asks it again under locks. */
final class DepreciationRunReadiness
{
    public function __construct(private readonly DepreciationPlanner $planner) {}

    /** @return list<Violation> */
    public function of(DepreciationRun $run): array
    {
        $v = [];
        $period = FiscalPeriod::query()->find($run->fiscal_period_id);
        if ($period === null || ! in_array($period->status, [PeriodStatus::Open, PeriodStatus::SoftClosed], true)) {
            $v[] = new Violation('period_closed', 'The period is closed; depreciation cannot post into it.');
        }
        if (DepreciationRun::query()->where('company_id', $run->company_id)->whereIn('status', ['draft', 'pending_approval'])
            ->where('as_of', '<', $run->as_of->format('Y-m-d'))->exists()) {
            $v[] = new Violation('earlier_run_pending', 'An earlier period\'s depreciation run is still waiting to be posted.');
        }
        if ($this->isStale($run)) {
            $v[] = new Violation('depreciation_run_stale', 'The assets changed since this run was drafted, so its figures are out of date. Void it and draft the run again.');
        }

        return $v;
    }

    /** Whether the register, as it is now, would give different figures from the ones stored on the run. */
    public function isStale(DepreciationRun $run): bool
    {
        $units = [];
        $stored = [];
        foreach ($run->lines()->get() as $l) {
            $units[$l->asset_id] = $l->units;
            $stored[$l->asset_id] = [$l->amount, $l->months, $l->units];
        }
        $plan = $this->planner->plan($run->company_id, $run->as_of->format('Y-m-d'), $units);
        $now = [];
        foreach ($plan->lines as $p) {
            $now[$p['asset']->id] = [$p['charge']->amount, count($p['charge']->months), $p['charge']->units];
        }
        ksort($now);
        ksort($stored);

        return $plan->pendingUnits !== [] || $now !== $stored;
    }
}
