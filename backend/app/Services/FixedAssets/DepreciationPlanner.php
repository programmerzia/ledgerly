<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Domain\FixedAssets\DepreciationCalculator;
use App\Domain\FixedAssets\DepreciationMethod;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\FixedAsset;

/** Works out a period's depreciation for every active asset of a company from the register as it stands now. */
final class DepreciationPlanner
{
    /**
     * @param  array<string, int>  $units  asset id → units used in the run (units of production)
     */
    public function plan(string $companyId, string $periodEnd, array $units): DepreciationPlan
    {
        $categories = AssetCategory::query()->where('company_id', $companyId)->get()->keyBy('id');
        $lines = [];
        $pending = [];
        $total = 0;
        $assets = FixedAsset::query()->where('company_id', $companyId)->where('status', 'active')->orderBy('number')->get();
        foreach ($assets as $asset) {
            $category = $categories->get($asset->category_id) ?? throw DomainRuleViolation::single('not_found', 'The asset category does not exist.');
            $state = $asset->state($category);
            $months = DepreciationCalculator::monthsDue($state, $periodEnd);
            if ($months === []) {
                continue;
            }
            if ($state->method === DepreciationMethod::UnitsOfProduction && ! array_key_exists($asset->id, $units)) {
                $pending[] = $asset;

                continue;
            }
            $charge = DepreciationCalculator::charge($state, $months, $units[$asset->id] ?? null);
            $lines[] = ['asset' => $asset, 'category' => $category, 'charge' => $charge];
            $total += $charge->amount;
        }

        return new DepreciationPlan($lines, $pending, $total);
    }
}
