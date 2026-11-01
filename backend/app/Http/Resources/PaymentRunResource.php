<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\PaymentRun;
use App\Models\Trade\PaymentRunItem;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A payment run. Totals are in the run `currency`; `total` is the net in base. `wht` figures are informational: the tax was
 * withheld when each bill posted, so the cash paid (`total_net`) is already net of it.
 *
 * @mixin PaymentRun
 */
final class PaymentRunResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);
        $cur = $this->currency;

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'cash_account_id' => $this->cash_account_id,
            'bank_account_id' => $this->bank_account_id,
            'run_date' => Json::date($this->run_date),
            'currency' => $cur,
            'fx_rate' => (string) $this->fx_rate,
            'total_gross' => Json::money($this->total_gross, $cur),
            'total_wht' => Json::money($this->total_wht, $cur),
            'total_net' => Json::money($this->total_net, $cur),
            'total' => Json::money($this->total, $base),
            'reference' => $this->reference,
            'memo' => $this->memo,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            'items' => $this->whenLoaded('items', fn () => $this->itemRows((string) $cur)),
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void',
            ]),
        ];
    }

    /** @return list<array{id: string, line_no: int, invoice_id: string, contact_id: string, amount_fc: array{amount: int, currency: string}, wht_amount_fc: array{amount: int, currency: string}}> */
    private function itemRows(string $cur): array
    {
        return array_values($this->items->map(fn (PaymentRunItem $i): array => [
            'id' => $i->id, 'line_no' => $i->line_no, 'invoice_id' => $i->invoice_id, 'contact_id' => $i->contact_id,
            'amount_fc' => Json::money($i->amount_fc, $cur), 'wht_amount_fc' => Json::money($i->wht_amount_fc, $cur),
        ])->all());
    }
}
