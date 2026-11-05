<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Contracts\Clock;
use App\Domain\Trade\PaymentStatus;
use App\Http\Support\Json;
use App\Models\Trade\Invoice;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An invoice, credit note, bill or debit note. `*_fc` amounts are in the document `currency`, the others in the
 * company's base currency (D1). `amount_due` is base: total − withheld tax − settled, never negative; for a credit
 * or debit note it is the credit still left to apply.
 *
 * @mixin Invoice
 */
final class InvoiceResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);
        $cur = $this->currency;
        $today = app(Clock::class)->now();

        return [
            'id' => $this->id,
            'kind' => $this->kind->value,
            'number' => $this->number,
            'status' => $this->status->value,
            'payment_status' => PaymentStatus::of($this->status, $this->amountDue(), $this->settled, $this->due_date, $today)->value,
            'contact_id' => $this->contact_id,
            'issue_date' => Json::date($this->issue_date),
            'due_date' => Json::date($this->due_date),
            'currency' => $cur,
            'fx_rate' => (string) $this->fx_rate,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'subtotal_fc' => Json::money($this->subtotal_fc, $cur),
            'tax_total_fc' => Json::money($this->tax_total_fc, $cur),
            'total_fc' => Json::money($this->total_fc, $cur),
            'subtotal' => Json::money($this->subtotal, $base),
            'tax_total' => Json::money($this->tax_total, $base),
            /** Self-assessed reverse-charge tax (bills): not in the total, not owed to the supplier. */
            'reverse_charge_total_fc' => Json::money($this->reverse_charge_total_fc, $cur),
            'reverse_charge_total' => Json::money($this->reverse_charge_total, $base),
            'total' => Json::money($this->total, $base),
            'wht_code_id' => $this->wht_code_id,
            'wht_amount_fc' => Json::money($this->wht_amount_fc, $cur),
            'wht_amount' => Json::money($this->wht_amount, $base),
            'settled_fc' => Json::money($this->settled_fc, $cur),
            'settled' => Json::money($this->settled, $base),
            'amount_due' => Json::money($this->status->value === 'posted' ? $this->amountDue() : 0, $base),
            'amount_due_fc' => Json::money($this->status->value === 'posted' ? $this->amountDueFc() : 0, $this->currency),
            'related_invoice_id' => $this->related_invoice_id,
            'journal_id' => $this->journal_id,
            'reversal_journal_id' => $this->reversal_journal_id,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            // The list answers summaries; one document comes with its lines.
            'lines' => $this->whenLoaded('lines', fn () => InvoiceLineResource::collection($this->lines->each(fn ($l) => $l->setRelation('invoice', $this->resource)))),
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve',
                'return' => 'return', 'void' => 'void', 'reverse' => 'reverse', 'override_match' => 'overrideMatch',
            ]),
        ];
    }
}
