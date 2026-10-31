<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string|null $fiscal_period_id
 * @property JournalType $journal_type
 * @property string|null $number
 * @property JournalStatus $status
 * @property DateTimeImmutable $journal_date
 * @property DateTimeImmutable|null $posted_at
 * @property string|null $reference
 * @property string|null $memo
 * @property string|null $source_type
 * @property string|null $source_id
 * @property string|null $reversal_of_id
 * @property string|null $reversed_by_id
 * @property int $total_debit
 * @property int $total_credit
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $posted_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property-read Collection<int, JournalLine> $lines
 */
class Journal extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'journal_type' => JournalType::class,
            'status' => JournalStatus::class,
            'journal_date' => 'immutable_date',
            'posted_at' => 'immutable_datetime',
            'total_debit' => 'integer',
            'total_credit' => 'integer',
            'lock_version' => 'integer',
        ];
    }

    /** @return HasMany<JournalLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(JournalLine::class)->orderBy('line_no');
    }
}
