<?php

declare(strict_types=1);

namespace App\Models\FixedAssets;

use App\Models\BaseModel;

/**
 * One signed change of an asset's figures, append-only. The register's figures are the sum of these rows; the asset
 * schedule is read from them; a reversal is another row with the opposite signs.
 *
 * @property string $id
 * @property string $company_id
 * @property string $asset_id
 * @property string $category_id
 * @property \DateTimeImmutable $movement_date
 * @property string $kind opening|addition|depreciation|disposal|impairment|impairment_reversal|revaluation|reversal
 * @property int $cost_delta
 * @property int $depreciation_delta
 * @property int $impairment_delta
 * @property int $reserve_delta
 * @property int $deficit_delta
 * @property int $months_delta
 * @property int $units_delta
 * @property string|null $journal_id
 * @property string|null $document_type
 * @property string|null $document_id
 * @property array<string, mixed> $meta
 */
class AssetMovement extends BaseModel
{
    public const UPDATED_AT = null;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'movement_date' => 'immutable_date', 'cost_delta' => 'integer', 'depreciation_delta' => 'integer',
            'impairment_delta' => 'integer', 'reserve_delta' => 'integer', 'deficit_delta' => 'integer',
            'months_delta' => 'integer', 'units_delta' => 'integer', 'meta' => 'array',
        ];
    }
}
