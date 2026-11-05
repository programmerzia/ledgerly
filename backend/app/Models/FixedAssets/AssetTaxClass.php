<?php

declare(strict_types=1);

namespace App\Models\FixedAssets;

use App\Models\BaseModel;

/**
 * A tax depreciation class: annual rate on cost and an optional first-year rate, in basis points (2000 = 20%).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $code
 * @property string $name
 * @property int $annual_rate_bp
 * @property int|null $first_year_rate_bp
 * @property string $source company, or the country pack that supplied it
 * @property bool $is_active
 * @property int $lock_version
 */
class AssetTaxClass extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['annual_rate_bp' => 'integer', 'first_year_rate_bp' => 'integer', 'is_active' => 'boolean', 'lock_version' => 'integer'];
    }
}
