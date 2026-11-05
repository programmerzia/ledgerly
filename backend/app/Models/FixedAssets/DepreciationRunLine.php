<?php

declare(strict_types=1);

namespace App\Models\FixedAssets;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $depreciation_run_id
 * @property int $line_no
 * @property string $asset_id
 * @property int $amount
 * @property int $months
 * @property int $units
 * @property array<string, mixed> $detail the month-by-month schedule behind the amount
 */
class DepreciationRunLine extends BaseModel
{
    /** @return BelongsTo<FixedAsset, $this> */
    public function asset(): BelongsTo
    {
        return $this->belongsTo(FixedAsset::class, 'asset_id');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['line_no' => 'integer', 'amount' => 'integer', 'months' => 'integer', 'units' => 'integer', 'detail' => 'array'];
    }
}
