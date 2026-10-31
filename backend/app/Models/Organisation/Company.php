<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use App\Models\BaseModel;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $name
 * @property string $base_currency
 * @property int $fiscal_year_start_month
 */
class Company extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['address' => 'array', 'settings' => 'array', 'fiscal_year_start_month' => 'integer'];
    }
}
