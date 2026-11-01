<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\CreditApplication;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Credit applied to an open document: from `settlement_id` (credit on account) or `note_id`. `amount_fc` is in the document currency,
 * `source_amount` the base released from the credit, `amount` the base carried for the document, `fx_gain_loss` positive for a gain.
 *
 * @mixin CreditApplication
 */
final class CreditApplicationResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);
        $cur = (string) ($this->resource->getAttribute('currency') ?? $base);

        return [
            'id' => $this->id,
            'settlement_id' => $this->settlement_id,
            'note_id' => $this->note_id,
            'invoice_id' => $this->invoice_id,
            'amount_fc' => Json::money($this->amount_fc, $cur),
            'source_amount' => Json::money($this->source_amount, $base),
            'amount' => Json::money($this->amount, $base),
            'fx_gain_loss' => Json::money($this->fx_gain_loss, $base),
            'applied_on' => Json::date($this->applied_on),
            'journal_id' => $this->journal_id,
            'reversal_journal_id' => $this->reversal_journal_id,
            'reversed_at' => Json::time($this->reversed_at),
            'created_by' => $this->created_by,
        ];
    }
}
