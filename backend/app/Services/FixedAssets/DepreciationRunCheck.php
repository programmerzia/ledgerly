<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Contracts\PeriodCloseCheck;
use App\Domain\Fiscal\CheckOutcome;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\FixedAssets\DepreciationRun;

/** DEPR_RUN: the period has its posted depreciation run, or no asset has depreciation due up to the period's end. */
final class DepreciationRunCheck implements PeriodCloseCheck
{
    public function __construct(private readonly DepreciationPlanner $planner) {}

    public function code(): string
    {
        return 'DEPR_RUN';
    }

    public function run(FiscalPeriod $period): CheckOutcome
    {
        if ($period->kind !== 'regular') {
            return new CheckOutcome($this->code(), true, 'The adjustment period is not depreciated.');
        }
        $run = DepreciationRun::query()->where('company_id', $period->company_id)->where('fiscal_period_id', $period->id)
            ->whereNotIn('status', ['void', 'reversed'])->first();
        if ($run !== null && $run->status->value === 'posted') {
            return new CheckOutcome($this->code(), true, "The depreciation run {$run->number} has been posted.", ['run_id' => $run->id]);
        }
        if ($run !== null) {
            return new CheckOutcome($this->code(), false, 'The depreciation run for this period is drafted but not posted yet.', ['run_id' => $run->id, 'status' => $run->status->value]);
        }

        $plan = $this->planner->plan($period->company_id, $period->ends_on->format('Y-m-d'), []);
        if (! $plan->hasWork()) {
            return new CheckOutcome($this->code(), true, 'No asset needs depreciating.');
        }

        return new CheckOutcome(
            $this->code(), false,
            count($plan->lines) + count($plan->pendingUnits).' asset(s) need depreciation for this period: run the depreciation.',
            ['assets' => count($plan->lines) + count($plan->pendingUnits), 'amount' => $plan->total],
        );
    }
}
