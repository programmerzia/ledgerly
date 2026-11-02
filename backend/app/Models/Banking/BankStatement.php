<?php

declare(strict_types=1);

namespace App\Models\Banking;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * @property string $id
 * @property string $company_id
 * @property string $bank_account_id
 * @property DateTimeImmutable $period_from
 * @property DateTimeImmutable $period_to
 * @property int|null $opening_balance
 * @property int|null $closing_balance
 * @property string $currency
 * @property string $source csv|ofx|camt|manual
 * @property string|null $file_name
 * @property string $file_hash
 * @property int $line_count
 * @property int $duplicates_skipped
 * @property list<string> $warnings
 * @property string|null $imported_by
 * @property DateTimeImmutable $imported_at
 */
class BankStatement extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'period_from' => 'immutable_date', 'period_to' => 'immutable_date', 'opening_balance' => 'integer', 'closing_balance' => 'integer',
            'line_count' => 'integer', 'duplicates_skipped' => 'integer', 'warnings' => 'array', 'imported_at' => 'immutable_datetime',
        ];
    }
}
