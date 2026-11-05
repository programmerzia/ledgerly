<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Transfers\FundTransfer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A fund transfer. `from_amount`/`fee` are in the source account's currency, `to_amount` in the destination's, `send_base`,
 * `receive_base` and `fx_difference` (positive is a gain) in the company's base currency.
 *
 * @mixin FundTransfer
 */
final class FundTransferResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'leg_state' => $this->leg_state,
            'from_bank_account_id' => $this->from_bank_account_id,
            'to_bank_account_id' => $this->to_bank_account_id,
            'send_date' => Json::date($this->send_date),
            'received_on' => Json::date($this->received_on),
            'from_amount' => Json::money($this->from_amount_fc, $this->from_currency),
            'send_rate' => (string) $this->send_rate,
            'send_base' => Json::money($this->send_base, $base),
            'fee' => Json::money($this->fee_fc, $this->from_currency),
            'fee_account_id' => $this->fee_account_id,
            'to_amount' => Json::money($this->to_amount_fc, $this->to_currency),
            'receive_rate' => (string) $this->receive_rate,
            'receive_base' => $this->receive_base === null ? null : Json::money($this->receive_base, $base),
            'fx_difference' => $this->fx_difference === null ? null : Json::money($this->fx_difference, $base),
            'settle_same_day' => $this->settle_same_day,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'send_journal_id' => $this->send_journal_id,
            'receive_journal_id' => $this->receive_journal_id,
            'send_reversal_journal_id' => $this->send_reversal_journal_id,
            'receive_reversal_journal_id' => $this->receive_reversal_journal_id,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void',
                'receive' => 'receive', 'reverse' => 'reverse',
            ]),
        ];
    }
}
