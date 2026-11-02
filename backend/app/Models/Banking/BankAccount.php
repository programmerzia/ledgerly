<?php

declare(strict_types=1);

namespace App\Models\Banking;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $name
 * @property string $account_id the GL account (control type bank or cash)
 * @property string $currency
 * @property string|null $bank_name
 * @property string|null $account_number_masked
 * @property string|null $iban
 * @property string|null $swift
 * @property string $kind bank|cash|card
 * @property array<string, mixed>|null $import_mapping
 * @property int|null $last_statement_balance
 * @property DateTimeImmutable|null $last_statement_date
 * @property bool $is_active
 * @property int $lock_version
 */
class BankAccount extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['import_mapping' => 'array', 'last_statement_balance' => 'integer', 'last_statement_date' => 'immutable_date', 'is_active' => 'boolean', 'lock_version' => 'integer'];
    }
}
