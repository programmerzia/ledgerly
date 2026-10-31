<?php

declare(strict_types=1);

namespace App\Models\Platform;

use App\Models\BaseModel;

/**
 * A shared chart-of-accounts template: global reference data with no tenant_id (05 §3). Every line
 * maps onto one `accounts` row; Database\Seeders\ChartLine documents the keys.
 *
 * @phpstan-type TemplateLine array{code: string, name: string, account_type: string, account_subtype: string|null, normal_balance: string, control_type: string, currency_policy: string, parent_code: string|null, description: string|null}
 *
 * @property string $id
 * @property string $code
 * @property string $name
 * @property string|null $country
 * @property string $standard
 * @property list<TemplateLine> $lines
 */
class ChartTemplate extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['lines' => 'array'];
    }
}
