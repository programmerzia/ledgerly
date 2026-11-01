<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Contracts\Postable;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A receipt, supplier payment, customer refund (`refund`) or supplier refund (`supplier_refund`) (D11).
 * `*_fc` amounts are in the settlement currency, the others in base. `unallocated_*` is credit on account (D9).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $kind
 * @property string|null $number
 * @property DocumentStatus $status
 * @property string $contact_id
 * @property string $cash_account_id
 * @property string|null $bank_account_id
 * @property DateTimeImmutable $settlement_date
 * @property string $currency
 * @property string $fx_rate
 * @property int $amount_fc
 * @property int $amount
 * @property int $unallocated_fc
 * @property int $unallocated
 * @property string|null $reference
 * @property string|null $memo
 * @property string|null $payment_run_id
 * @property string|null $journal_id
 * @property string|null $reversal_journal_id
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property string|null $posted_by
 * @property DateTimeImmutable|null $posted_at
 * @property-read Collection<int, SettlementAllocation> $allocations
 */
class Settlement extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DocumentStatus::class,
            'settlement_date' => 'immutable_date',
            'posted_at' => 'immutable_datetime',
            'amount_fc' => 'integer', 'amount' => 'integer', 'unallocated_fc' => 'integer', 'unallocated' => 'integer',
            'lock_version' => 'integer',
        ];
    }

    /** @return HasMany<SettlementAllocation, $this> */
    public function allocations(): HasMany
    {
        return $this->hasMany(SettlementAllocation::class)->orderBy('created_at')->orderBy('id');
    }

    public function isCashIn(): bool
    {
        return $this->kind === 'receipt' || $this->kind === 'supplier_refund';
    }

    public function isOnReceivables(): bool
    {
        return $this->kind === 'receipt' || $this->kind === 'refund';
    }

    /** The permission module of the kind: receipts for receipts, payments for the rest. */
    public function module(): string
    {
        return $this->kind === 'receipt' ? 'receipts' : 'payments';
    }

    public function documentType(): string
    {
        return 'settlement';
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
            'contact_id' => $this->contact_id,
            'cash_account_id' => $this->cash_account_id,
            'settlement_date' => $this->settlement_date->format('Y-m-d'),
            'currency' => $this->currency,
            'fx_rate' => (string) $this->fx_rate,
            'amount_fc' => $this->amount_fc,
            'amount' => $this->amount,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'payment_run_id' => $this->payment_run_id,
            'dims' => array_map(fn (int $p) => $this->getAttribute("dim{$p}_value_id"), range(1, 8)),
            'allocations' => $this->allocations->map(fn (SettlementAllocation $a) => [
                'invoice_id' => $a->invoice_id, 'source_settlement_id' => $a->source_settlement_id, 'amount_fc' => $a->amount_fc,
            ])->sortBy(fn (array $a) => ($a['invoice_id'] ?? '').($a['source_settlement_id'] ?? ''))->values()->all(),
        ];
    }
}
