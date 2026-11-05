<?php

declare(strict_types=1);

namespace App\Models\FixedAssets;

use App\Contracts\Postable;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The depreciation of every asset for one period, approved and posted as one journal.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string|null $number
 * @property DocumentStatus $status
 * @property string $fiscal_period_id
 * @property DateTimeImmutable $as_of
 * @property int $total
 * @property string|null $journal_id
 * @property string|null $reversal_journal_id
 * @property string|null $memo
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property string|null $posted_by
 * @property DateTimeImmutable|null $posted_at
 * @property-read Collection<int, DepreciationRunLine> $lines
 */
class DepreciationRun extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['status' => DocumentStatus::class, 'as_of' => 'immutable_date', 'posted_at' => 'immutable_datetime', 'total' => 'integer', 'lock_version' => 'integer'];
    }

    /** @return HasMany<DepreciationRunLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(DepreciationRunLine::class)->orderBy('line_no');
    }

    public function documentType(): string
    {
        return 'depreciation_run';
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
        return $this->status;
    }

    public function documentAmount(): int
    {
        return $this->total;
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

    public function documentContent(): array
    {
        return [
            'id' => $this->id,
            'fiscal_period_id' => $this->fiscal_period_id,
            'as_of' => $this->as_of->format('Y-m-d'),
            'total' => $this->total,
            'memo' => $this->memo,
            'lines' => $this->lines->map(fn (DepreciationRunLine $l) => [
                'line_no' => $l->line_no, 'asset_id' => $l->asset_id, 'amount' => $l->amount, 'months' => $l->months, 'units' => $l->units,
            ])->values()->all(),
        ];
    }
}
