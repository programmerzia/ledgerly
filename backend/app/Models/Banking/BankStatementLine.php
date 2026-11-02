<?php

declare(strict_types=1);

namespace App\Models\Banking;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $statement_id
 * @property string $bank_account_id
 * @property int $line_no
 * @property DateTimeImmutable $txn_date
 * @property DateTimeImmutable|null $value_date
 * @property int $amount signed, money in positive
 * @property string $currency
 * @property string $description
 * @property string|null $reference
 * @property string|null $counterparty
 * @property int|null $balance_after
 * @property string $dedupe_hash
 * @property string $status unmatched|matched|excluded
 * @property string|null $excluded_reason
 * @property int $lock_version
 * @property string|null $match_id from the list query
 * @property string|null $pending_journal_id from the list query
 */
class BankStatementLine extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['txn_date' => 'immutable_date', 'value_date' => 'immutable_date', 'amount' => 'integer', 'balance_after' => 'integer', 'lock_version' => 'integer'];
    }
}
