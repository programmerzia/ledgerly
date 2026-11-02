<?php

declare(strict_types=1);

namespace App\Models\Banking;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * @property string $id
 * @property string $company_id
 * @property string $bank_account_id
 * @property string $statement_id
 * @property DateTimeImmutable $as_of
 * @property string $status in_progress|finished
 * @property int|null $book_balance
 * @property int|null $statement_balance
 * @property int|null $difference
 * @property array<string, mixed>|null $report
 * @property string|null $started_by
 * @property string|null $finished_by
 * @property DateTimeImmutable|null $finished_at
 * @property string|null $reopened_by
 * @property DateTimeImmutable|null $reopened_at
 * @property string|null $reopen_reason
 * @property int $reopen_count
 * @property int $lock_version
 */
class BankReconciliation extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'as_of' => 'immutable_date', 'book_balance' => 'integer', 'statement_balance' => 'integer', 'difference' => 'integer', 'report' => 'array',
            'finished_at' => 'immutable_datetime', 'reopened_at' => 'immutable_datetime', 'reopen_count' => 'integer', 'lock_version' => 'integer',
        ];
    }
}
