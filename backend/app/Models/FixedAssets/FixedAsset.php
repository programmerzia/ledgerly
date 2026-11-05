<?php

declare(strict_types=1);

namespace App\Models\FixedAssets;

use App\Domain\FixedAssets\AssetState;
use App\Domain\FixedAssets\DepreciationMethod;
use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One register entry. Figures are kept in step with `asset_movements` by App\Services\FixedAssets\AssetLedger only.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $number
 * @property string $name
 * @property string|null $description
 * @property string $category_id
 * @property string $status active|disposed
 * @property DateTimeImmutable $acquired_on
 * @property DateTimeImmutable $available_from
 * @property DateTimeImmutable|null $disposed_on
 * @property int $acquisition_cost
 * @property int $cost
 * @property int $residual
 * @property int $accumulated_depreciation
 * @property int $accumulated_impairment
 * @property int $revaluation_reserve
 * @property int $revaluation_deficit
 * @property int|null $counterfactual_carrying
 * @property string $method
 * @property int|null $useful_life_months
 * @property int|null $declining_rate_bp
 * @property int|null $units_total
 * @property int $units_used
 * @property int $months_charged
 * @property DateTimeImmutable|null $depreciated_through
 * @property bool $is_opening
 * @property int $opening_accumulated
 * @property DateTimeImmutable|null $opening_as_of
 * @property string|null $source_type
 * @property string|null $source_id
 * @property string|null $source_journal_id
 * @property int $lock_version
 * @property string|null $created_by
 * @property-read AssetCategory|null $category
 */
class FixedAsset extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'acquired_on' => 'immutable_date', 'available_from' => 'immutable_date', 'disposed_on' => 'immutable_date',
            'depreciated_through' => 'immutable_date', 'opening_as_of' => 'immutable_date',
            'acquisition_cost' => 'integer', 'cost' => 'integer', 'residual' => 'integer', 'accumulated_depreciation' => 'integer',
            'accumulated_impairment' => 'integer', 'revaluation_reserve' => 'integer', 'revaluation_deficit' => 'integer',
            'counterfactual_carrying' => 'integer', 'useful_life_months' => 'integer', 'declining_rate_bp' => 'integer',
            'units_total' => 'integer', 'units_used' => 'integer', 'months_charged' => 'integer', 'opening_accumulated' => 'integer',
            'is_opening' => 'boolean', 'lock_version' => 'integer',
        ];
    }

    /** @return BelongsTo<AssetCategory, $this> */
    public function category(): BelongsTo
    {
        return $this->belongsTo(AssetCategory::class, 'category_id');
    }

    public function carrying(): int
    {
        return $this->cost - $this->accumulated_depreciation - $this->accumulated_impairment;
    }

    /** @return array<int, string|null> dimension position → value id */
    public function dimensions(): array
    {
        $dims = [];
        for ($p = 1; $p <= 8; $p++) {
            $v = $this->getAttribute("dim{$p}_value_id");
            $dims[$p] = is_string($v) ? $v : null;
        }

        return $dims;
    }

    public function state(AssetCategory $category): AssetState
    {
        return new AssetState(
            $this->cost, $this->residual, $this->accumulated_depreciation, $this->accumulated_impairment,
            DepreciationMethod::from($this->method), $this->useful_life_months, $this->declining_rate_bp,
            $this->units_total, $this->units_used, $this->months_charged, $this->available_from->format('Y-m-d'),
            $this->depreciated_through?->format('Y-m-d'), $category->is_depreciable, $this->status === 'disposed',
            $this->counterfactual_carrying, $this->revaluation_reserve, $this->revaluation_deficit, $category->isRevalued(),
        );
    }
}
