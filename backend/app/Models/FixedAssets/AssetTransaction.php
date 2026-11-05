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
 * A disposal, impairment, impairment reversal or the revaluation of a whole category: approved, signed and posted as one journal.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string|null $number
 * @property string $kind disposal|impairment|impairment_reversal|revaluation
 * @property DocumentStatus $status
 * @property DateTimeImmutable $tx_date
 * @property string|null $category_id set for a revaluation
 * @property int $amount the size of the event, for approval thresholds
 * @property string|null $reason
 * @property array<string, mixed> $params proceeds, proceeds_account_id, transfer_reserve (disposal)
 * @property string|null $journal_id
 * @property string|null $reversal_journal_id
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property string|null $posted_by
 * @property DateTimeImmutable|null $posted_at
 * @property-read Collection<int, AssetTransactionLine> $lines
 */
class AssetTransaction extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DocumentStatus::class, 'tx_date' => 'immutable_date', 'posted_at' => 'immutable_datetime',
            'amount' => 'integer', 'lock_version' => 'integer', 'params' => 'array',
        ];
    }

    /** @return HasMany<AssetTransactionLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(AssetTransactionLine::class)->orderBy('line_no');
    }

    /** The journal's source type: an impairment of a revalued asset is a revaluation decrease (IAS 36.60), so it is booked as one. */
    public function journalSource(bool $revalued): string
    {
        return match (true) {
            $this->kind === 'disposal' => 'asset_disposal',
            $this->kind === 'revaluation', $revalued => 'asset_revaluation',
            default => 'asset_impairment',
        };
    }

    public function documentType(): string
    {
        return 'asset_transaction';
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
        return $this->amount;
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
            'kind' => $this->kind,
            'tx_date' => $this->tx_date->format('Y-m-d'),
            'category_id' => $this->category_id,
            'amount' => $this->amount,
            'reason' => $this->reason,
            'params' => $this->params,
            'lines' => $this->lines->map(fn (AssetTransactionLine $l) => [
                'line_no' => $l->line_no, 'asset_id' => $l->asset_id, 'input_amount' => $l->input_amount, 'figures' => $l->figures,
            ])->values()->all(),
        ];
    }
}
