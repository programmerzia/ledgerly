<?php

declare(strict_types=1);

namespace App\Models\Procurement;

use App\Contracts\Postable;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Workflow\DocumentStatus;
use App\Models\BaseModel;
use App\Models\Trade\Contact;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property PurchaseOrderStatus $status
 * @property string $contact_id
 * @property CarbonImmutable $order_date
 * @property CarbonImmutable|null $expected_date
 * @property string $currency
 * @property string $fx_rate
 * @property string|null $reference
 * @property string|null $memo
 * @property int $subtotal_fc
 * @property int $tax_total_fc
 * @property int $total_fc
 * @property int $subtotal
 * @property int $tax_total
 * @property int $total
 * @property int $revision
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property CarbonImmutable|null $approved_at
 * @property string|null $cancelled_by
 * @property CarbonImmutable|null $cancelled_at
 * @property string|null $cancel_reason
 * @property string|null $closed_by
 * @property CarbonImmutable|null $closed_at
 * @property-read Collection<int, PurchaseOrderLine> $lines
 * @property-read Contact $contact
 */
class PurchaseOrder extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => PurchaseOrderStatus::class,
            'order_date' => 'immutable_date', 'expected_date' => 'immutable_date',
            'approved_at' => 'immutable_datetime', 'cancelled_at' => 'immutable_datetime', 'closed_at' => 'immutable_datetime',
            'subtotal_fc' => 'integer', 'tax_total_fc' => 'integer', 'total_fc' => 'integer',
            'subtotal' => 'integer', 'tax_total' => 'integer', 'total' => 'integer',
            'revision' => 'integer', 'lock_version' => 'integer',
        ];
    }

    /** @return HasMany<PurchaseOrderLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseOrderLine::class)->orderBy('line_no');
    }

    /** @return BelongsTo<Contact, $this> */
    public function contact(): BelongsTo
    {
        return $this->belongsTo(Contact::class);
    }

    public function documentType(): string
    {
        return 'purchase_order';
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
        return $this->status->documentStatus();
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
     * Header and lines as fixed before signing, in the shape a revision's before and after are kept in.
     *
     * @return array<string, mixed>
     */
    public function documentContent(): array
    {
        return [
            'id' => $this->id,
            'revision' => $this->revision,
            'contact_id' => $this->contact_id,
            'order_date' => $this->order_date->format('Y-m-d'),
            'expected_date' => $this->expected_date?->format('Y-m-d'),
            'currency' => $this->currency,
            'fx_rate' => (string) $this->fx_rate,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'totals' => [
                'subtotal_fc' => $this->subtotal_fc, 'tax_total_fc' => $this->tax_total_fc, 'total_fc' => $this->total_fc,
                'subtotal' => $this->subtotal, 'tax_total' => $this->tax_total, 'total' => $this->total,
            ],
            'lines' => $this->lines->map(fn (PurchaseOrderLine $l) => [
                'id' => $l->id, 'line_no' => $l->line_no, 'item_id' => $l->item_id, 'account_id' => $l->account_id, 'description' => $l->description,
                'quantity' => (string) $l->quantity, 'unit_price_fc' => $l->unit_price_fc, 'tax_code_id' => $l->tax_code_id,
                'line_total_fc' => $l->line_total_fc, 'tax_amount_fc' => $l->tax_amount_fc,
                'dims' => array_map(fn (int $p) => $l->dimensionValue($p), range(1, 8)),
            ])->values()->all(),
        ];
    }
}
