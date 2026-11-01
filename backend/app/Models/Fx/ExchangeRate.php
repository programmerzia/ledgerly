<?php

declare(strict_types=1);

namespace App\Models\Fx;

use App\Models\BaseModel;
use Carbon\CarbonImmutable;
use DateTimeImmutable;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $from_currency
 * @property string $to_currency
 * @property DateTimeImmutable $rate_date
 * @property string $rate decimal string, base units per 1 unit of from_currency
 * @property string $source manual|provider|document
 * @property string|null $created_by
 * @property CarbonImmutable $created_at
 */
class ExchangeRate extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['rate_date' => 'immutable_date', 'created_at' => 'immutable_datetime'];
    }
}
