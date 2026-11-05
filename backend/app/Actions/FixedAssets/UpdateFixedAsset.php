<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets;

use App\Actions\FixedAssets\Inputs\FixedAssetUpdateInput;
use App\Actions\Ledger\SetupGuard;
use App\Domain\FixedAssets\Estimates;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Edits a register entry (`fixed_assets.manage`). Cost and accumulated figures only ever change through a posted
 * document. A change of life, residual value, method, rate or units is a change of estimate (IAS 8.36): it is applied by
 * the next depreciation run, from the asset's carrying amount then, and nothing already posted is rewritten. The audit
 * event records the old and new estimates.
 */
final class UpdateFixedAsset
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard) {}

    public function handle(Actor $actor, string $assetId, FixedAssetUpdateInput $in): FixedAsset
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $assetId, $in) {
            $asset = $locks->document(FixedAsset::query()->findOrFail($assetId), $in->version);
            $this->guard->require($actor, 'fixed_assets.manage', $asset->company_id);
            if ($asset->status === 'disposed') {
                throw DomainRuleViolation::single('asset_disposed', 'A disposed asset cannot be changed.');
            }
            $category = AssetCategory::query()->findOrFail($asset->category_id);
            $method = $in->method;
            $rate = $method === 'declining_balance' ? $in->decliningRateBp : null;
            $units = $method === 'units_of_production' ? $in->unitsTotal : null;
            Estimates::assert($category->is_depreciable, $method, $in->lifeMonths, $rate, $units);

            if ($in->residual < 0 || $in->residual > $asset->carrying()) {
                throw DomainRuleViolation::single('asset_residual_invalid', 'The residual value must be between zero and the carrying amount.');
            }
            $fullyDepreciated = $asset->carrying() <= $in->residual;
            if ($method === 'straight_line' && $in->lifeMonths !== null && $in->lifeMonths <= $asset->months_charged && ! $fullyDepreciated) {
                throw DomainRuleViolation::single('asset_life_too_short', "{$asset->months_charged} months have been charged already, so the total life must be longer than that.");
            }
            if ($method === 'units_of_production' && $units !== null && $units <= $asset->units_used) {
                throw DomainRuleViolation::single('asset_units_too_few', "{$asset->units_used} units have been used already, so the total must be higher.");
            }

            $columns = [
                'name' => $in->name, 'description' => $in->description, 'residual' => $in->residual, 'method' => $method,
                'useful_life_months' => $in->lifeMonths, 'declining_rate_bp' => $rate, 'units_total' => $units,
            ];
            $dims = $this->dimensions($asset->company_id, $in->dimensions);
            for ($p = 1; $p <= 8; $p++) {
                $columns["dim{$p}_value_id"] = $dims[$p] ?? null;
            }
            $estimateKeys = ['residual', 'method', 'useful_life_months', 'declining_rate_bp', 'units_total'];
            $changed = array_filter($estimateKeys, fn (string $k): bool => $asset->getAttribute($k) !== $columns[$k]);
            $estimateBefore = $asset->only($estimateKeys);

            $before = $asset->attributesToArray();
            $asset->forceFill([...$columns, 'lock_version' => $asset->lock_version + 1])->save();
            $asset->refresh();
            $audit->add('fixed_asset.updated', $asset, before: $before, after: $asset, context: $changed === [] ? [] : [
                'change_of_estimate' => array_values($changed), 'estimate_before' => $estimateBefore, 'applies_from' => 'next depreciation run',
            ]);

            return $asset;
        });
    }

    /**
     * @param  array<string, string>  $input
     * @return array<int, string>
     */
    private function dimensions(string $companyId, array $input): array
    {
        $out = [];
        foreach ($input as $dimensionId => $valueId) {
            $dimension = Dimension::query()->where('company_id', $companyId)->find($dimensionId);
            $value = DimensionValue::query()->where('company_id', $companyId)->where('dimension_id', $dimensionId)->find($valueId);
            if ($dimension === null || $value === null || ! $value->is_active) {
                throw DomainRuleViolation::single('dimension_value_invalid', 'A dimension value does not exist, is inactive, or belongs to another dimension.');
            }
            $out[$dimension->position] = $value->id;
        }

        return $out;
    }
}
