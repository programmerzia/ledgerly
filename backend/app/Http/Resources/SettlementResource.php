<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\Settlement;
use App\Models\Trade\SettlementAllocation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A receipt, payment or refund. `*_fc` amounts are in the settlement `currency`, the others in base. `unallocated_*` is credit on
 * account (D9); for a draft it is what the allocations leave. Allocations carry the base value the document was carried at (D4) and the
 * realised exchange difference (positive is a gain).
 *
 * @mixin Settlement
 */
final class SettlementResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);
        $cur = $this->currency;
        $posted = in_array($this->status->value, ['posted', 'reversed'], true);
        $allocatedFc = $this->relationLoaded('allocations') ? (int) $this->allocations->sum('amount_fc') : null;
        $unallocatedFc = $posted ? $this->unallocated_fc : ($allocatedFc === null ? $this->unallocated_fc : $this->amount_fc - $allocatedFc);

        return [
            'id' => $this->id,
            'kind' => $this->kind,
            'number' => $this->number,
            'status' => $this->status->value,
            'contact_id' => $this->contact_id,
            'cash_account_id' => $this->cash_account_id,
            'bank_account_id' => $this->bank_account_id,
            'settlement_date' => Json::date($this->settlement_date),
            'currency' => $cur,
            'fx_rate' => (string) $this->fx_rate,
            'amount_fc' => Json::money($this->amount_fc, $cur),
            'amount' => Json::money($this->amount, $base),
            'unallocated_fc' => Json::money($unallocatedFc, $cur),
            'unallocated' => Json::money($posted ? $this->unallocated : 0, $base),
            'reference' => $this->reference,
            'memo' => $this->memo,
            'payment_run_id' => $this->payment_run_id,
            'journal_id' => $this->journal_id,
            'reversal_journal_id' => $this->reversal_journal_id,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            'allocations' => $this->whenLoaded('allocations', fn () => $this->allocationRows((string) $cur, $base)),
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return',
                'void' => 'void', 'reverse' => 'reverse', 'allocate' => 'allocate',
            ]),
        ];
    }

    /** @return list<array{id: string, invoice_id: string|null, source_settlement_id: string|null, amount_fc: array{amount: int, currency: string}, amount: array{amount: int, currency: string}, fx_gain_loss: array{amount: int, currency: string}}> */
    private function allocationRows(string $cur, string $base): array
    {
        return array_values($this->allocations->map(fn (SettlementAllocation $a): array => [
            'id' => $a->id,
            'invoice_id' => $a->invoice_id,
            'source_settlement_id' => $a->source_settlement_id,
            'amount_fc' => Json::money($a->amount_fc, $cur),
            'amount' => Json::money($a->amount, $base),
            'fx_gain_loss' => Json::money($a->fx_gain_loss, $base),
        ])->all());
    }
}
