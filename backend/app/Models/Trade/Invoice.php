<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Contracts\Postable;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * An invoice, credit note, bill or debit note. `fc` amounts are in the document currency, plain ones in base (D1).
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property InvoiceKind $kind
 * @property string|null $number
 * @property DocumentStatus $status
 * @property string $contact_id
 * @property DateTimeImmutable $issue_date
 * @property DateTimeImmutable $due_date
 * @property string $currency
 * @property string $fx_rate
 * @property string|null $reference
 * @property string|null $memo
 * @property int $subtotal_fc
 * @property int $tax_total_fc
 * @property int $reverse_charge_total_fc
 * @property int $reverse_charge_total
 * @property int $total_fc
 * @property int $subtotal
 * @property int $tax_total
 * @property int $total
 * @property string|null $wht_code_id
 * @property int $wht_amount_fc
 * @property int $wht_amount
 * @property int $settled_fc
 * @property int $settled
 * @property string|null $related_invoice_id
 * @property string|null $journal_id
 * @property string|null $reversal_journal_id
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property string|null $posted_by
 * @property DateTimeImmutable|null $posted_at
 * @property-read Collection<int, InvoiceLine> $lines
 */
class Invoice extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'kind' => InvoiceKind::class,
            'status' => DocumentStatus::class,
            'issue_date' => 'immutable_date',
            'due_date' => 'immutable_date',
            'posted_at' => 'immutable_datetime',
            'subtotal_fc' => 'integer', 'tax_total_fc' => 'integer', 'total_fc' => 'integer',
            'subtotal' => 'integer', 'tax_total' => 'integer', 'total' => 'integer', 'reverse_charge_total_fc' => 'integer', 'reverse_charge_total' => 'integer',
            'wht_amount_fc' => 'integer', 'wht_amount' => 'integer',
            'settled_fc' => 'integer', 'settled' => 'integer',
            'lock_version' => 'integer',
        ];
    }

    /** @return HasMany<InvoiceLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(InvoiceLine::class)->orderBy('line_no');
    }

    /** What is still owed, in base: for supplier documents the withheld tax is not owed to the supplier (docStatus.ts). */
    public function amountDue(): int
    {
        return max(0, $this->total - $this->wht_amount - $this->settled);
    }

    /** The same in the document currency. */
    public function amountDueFc(): int
    {
        return max(0, $this->total_fc - $this->wht_amount_fc - $this->settled_fc);
    }

    public function documentType(): string
    {
        return $this->kind->documentType();
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

    /** Base total: workflow thresholds are in base currency. */
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

    /**
     * Header and lines as fixed before signing: no number, status, journal link or timestamps, which are assigned
     * at posting, so a signature can be re-verified from the posted row.
     */
    public function documentContent(): array
    {
        return [
            'id' => $this->id,
            'kind' => $this->kind->value,
            'contact_id' => $this->contact_id,
            'issue_date' => $this->issue_date->format('Y-m-d'),
            'due_date' => $this->due_date->format('Y-m-d'),
            'currency' => $this->currency,
            'fx_rate' => (string) $this->fx_rate,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'related_invoice_id' => $this->related_invoice_id,
            'wht_code_id' => $this->wht_code_id,
            'totals' => [
                'subtotal_fc' => $this->subtotal_fc, 'tax_total_fc' => $this->tax_total_fc, 'total_fc' => $this->total_fc,
                'subtotal' => $this->subtotal, 'tax_total' => $this->tax_total, 'total' => $this->total,
                'wht_amount_fc' => $this->wht_amount_fc, 'wht_amount' => $this->wht_amount,
            ],
            'lines' => $this->lines->map(fn (InvoiceLine $l) => [
                'line_no' => $l->line_no, 'item_id' => $l->item_id, 'account_id' => $l->account_id, 'description' => $l->description,
                'quantity' => (string) $l->quantity, 'unit_price_fc' => $l->unit_price_fc, 'discount_pct' => (string) $l->discount_pct,
                'tax_code_id' => $l->tax_code_id, 'line_total_fc' => $l->line_total_fc, 'tax_amount_fc' => $l->tax_amount_fc,
                'dims' => array_map(fn (int $p) => $l->dimensionValue($p), range(1, 8)),
            ])->values()->all(),
        ];
    }
}
