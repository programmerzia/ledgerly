<?php

declare(strict_types=1);

namespace App\Models\Ledger;

use App\Contracts\Postable;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Workflow\DocumentStatus;
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
class Journal extends BaseModel implements Postable
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

    public function documentType(): string
    {
        return 'journal';
    }

    public function documentId(): string
    {
        return $this->id;
    }

    public function documentCompanyId(): string
    {
        return $this->company_id;
    }

    public function documentStatus(): DocumentStatus
    {
        return DocumentStatus::from($this->status->value);
    }

    /** Drafts carry no totals until they post, so the workflow amount comes from the lines. */
    public function documentAmount(): int
    {
        return max((int) $this->lines->sum('debit'), (int) $this->lines->sum('credit'));
    }

    public function documentCreatedBy(): ?string
    {
        return $this->created_by;
    }

    public function documentSubmittedBy(): ?string
    {
        return $this->submitted_by;
    }

    public function documentLockVersion(): int
    {
        return $this->lock_version;
    }

    /**
     * Only fields that are fixed before signing and never change at posting, so a signature can be
     * re-verified from the posted row: no period id (assigned at posting for regular journals),
     * number, status or timestamps. The date determines the period.
     */
    public function documentContent(): array
    {
        return [
            'id' => $this->id,
            'journal_type' => $this->journal_type->value,
            'journal_date' => $this->journal_date->format('Y-m-d'),
            'reference' => $this->reference,
            'memo' => $this->memo,
            'lines' => $this->lines->map(fn (JournalLine $l) => [
                'line_no' => $l->line_no, 'account_id' => $l->account_id, 'debit' => $l->debit, 'credit' => $l->credit,
                'currency' => $l->currency, 'amount_fc' => $l->amount_fc, 'description' => $l->description,
                'dims' => array_map(fn (int $p) => $l->getAttribute("dim{$p}_value_id"), range(1, 8)),
            ])->values()->all(),
        ];
    }
}
