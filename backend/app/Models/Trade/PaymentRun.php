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
 * A batch of supplier payments: select bills, group by supplier, approve, then one payment settlement per supplier
 * posts in one transaction. Amounts are in the run currency (`total_*`), `total` is the net in base.
 *
 * @property string $id
 * @property string $company_id
 * @property string|null $number
 * @property DocumentStatus $status
 * @property string $cash_account_id
 * @property string|null $bank_account_id
 * @property DateTimeImmutable $run_date
 * @property string $currency
 * @property string $fx_rate
 * @property int $total_gross
 * @property int $total_wht
 * @property int $total_net
 * @property int $total
 * @property string|null $reference
 * @property string|null $memo
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $submitted_by
 * @property string|null $approved_by
 * @property string|null $posted_by
 * @property DateTimeImmutable|null $posted_at
 * @property-read Collection<int, PaymentRunItem> $items
 */
class PaymentRun extends BaseModel implements Postable
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => DocumentStatus::class, 'run_date' => 'immutable_date', 'posted_at' => 'immutable_datetime',
            'total_gross' => 'integer', 'total_wht' => 'integer', 'total_net' => 'integer', 'total' => 'integer', 'lock_version' => 'integer',
        ];
    }

    /** @return HasMany<PaymentRunItem, $this> */
    public function items(): HasMany
    {
        return $this->hasMany(PaymentRunItem::class)->orderBy('line_no');
    }

    public function documentType(): string
    {
        return 'payment_run';
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
            'cash_account_id' => $this->cash_account_id,
            'run_date' => $this->run_date->format('Y-m-d'),
            'currency' => $this->currency,
            'fx_rate' => (string) $this->fx_rate,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'totals' => ['gross' => $this->total_gross, 'wht' => $this->total_wht, 'net' => $this->total_net, 'base' => $this->total],
            'items' => $this->items->map(fn (PaymentRunItem $i) => [
                'line_no' => $i->line_no, 'invoice_id' => $i->invoice_id, 'contact_id' => $i->contact_id, 'amount_fc' => $i->amount_fc,
            ])->values()->all(),
        ];
    }
}
