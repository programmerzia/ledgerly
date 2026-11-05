<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\FixedAssets\FixedAsset;
use App\Services\FixedAssets\DepreciationPlanner;

/**
 * What a depreciation run for a period would charge, and what would stop it. Writes nothing and takes no lock: the run
 * is checked again, under locks, when it is made and when it posts.
 */
final class PreviewDepreciation
{
    public function __construct(private readonly DepreciationPlanner $planner) {}

    /** @param array<string, int> $units asset id → units used (units-of-production assets) */
    public function __invoke(string $companyId, string $periodId, array $units): DepreciationPreviewData
    {
        $period = FiscalPeriod::query()->where('company_id', $companyId)->find($periodId)
            ?? throw DomainRuleViolation::single('not_found', 'The period does not exist.');
        $end = $period->ends_on->format('Y-m-d');
        $plan = $this->planner->plan($companyId, $end, $units);
        $categories = AssetCategory::query()->where('company_id', $companyId)->pluck('name', 'id');

        $blockers = [];
        if ($period->kind !== 'regular' || ! in_array($period->status, [PeriodStatus::Open, PeriodStatus::SoftClosed], true)) {
            $blockers[] = 'period_closed';
        }
        $runs = DepreciationRun::query()->where('company_id', $companyId)->whereNotIn('status', ['void', 'reversed']);
        if ($runs->clone()->where('fiscal_period_id', $period->id)->exists()) {
            $blockers[] = 'depreciation_run_exists';
        }
        if ($runs->clone()->where('as_of', '<', $end)->whereIn('status', ['draft', 'pending_approval'])->exists()) {
            $blockers[] = 'earlier_run_pending';
        }
        if ($plan->pendingUnits !== []) {
            $blockers[] = 'units_required';
        }
        if (! $plan->hasWork()) {
            $blockers[] = 'nothing_to_depreciate';
        }

        $lines = [];
        foreach ($plan->lines as $l) {
            $c = $l['charge'];
            $lines[] = new DepreciationPreviewLine(
                $l['asset']->id, $l['asset']->number, $l['asset']->name, (string) ($categories[$l['asset']->category_id] ?? ''), $l['asset']->method,
                count($c->months), $c->catchUpMonths($end), $c->amount, $c->units, $l['asset']->carrying(), $c->newCarrying,
            );
        }
        $pending = array_map(fn (FixedAsset $a): DepreciationPreviewLine => new DepreciationPreviewLine(
            $a->id, $a->number, $a->name, (string) ($categories[$a->category_id] ?? ''), $a->method, 0, 0, 0, 0, $a->carrying(), $a->carrying(),
        ), $plan->pendingUnits);

        return new DepreciationPreviewData($period->id, $period->name, $end, $plan->total, $lines, $pending, $blockers);
    }
}
