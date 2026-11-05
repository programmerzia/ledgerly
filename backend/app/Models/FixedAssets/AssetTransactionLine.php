<?php

declare(strict_types=1);

namespace App\Models\FixedAssets;

use App\Models\BaseModel;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $asset_transaction_id
 * @property int $line_no
 * @property string $asset_id
 * @property int $input_amount the impairment or reversal amount, or the revalued amount; unused (0) for a disposal
 * @property array<string, mixed> $figures the outcome the preview showed (see AssetOutcome::toArray)
 */
class AssetTransactionLine extends BaseModel
{
    /** @return BelongsTo<FixedAsset, $this> */
    public function asset(): BelongsTo
    {
        return $this->belongsTo(FixedAsset::class, 'asset_id');
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['line_no' => 'integer', 'input_amount' => 'integer', 'figures' => 'array'];
    }
}
