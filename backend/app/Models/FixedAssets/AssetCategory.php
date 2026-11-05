<?php

declare(strict_types=1);

namespace App\Models\FixedAssets;

use App\Models\BaseModel;

/**
 * A class of assets with the accounts its movements post to, the default depreciation settings and the measurement model
 * (cost or revaluation, chosen per class as IAS 16.29 and 16.36 require).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $name
 * @property string $asset_account_id
 * @property string $accumulated_account_id
 * @property string $expense_account_id
 * @property string $measurement_model cost|revaluation
 * @property string $default_method
 * @property int|null $default_life_months
 * @property int|null $default_declining_rate_bp
 * @property bool $is_depreciable false for land and similar
 * @property bool $is_active
 * @property int $lock_version
 */
class AssetCategory extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'default_life_months' => 'integer', 'default_declining_rate_bp' => 'integer',
            'is_depreciable' => 'boolean', 'is_active' => 'boolean', 'lock_version' => 'integer',
        ];
    }

    public function isRevalued(): bool
    {
        return $this->measurement_model === 'revaluation';
    }
}
