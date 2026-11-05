<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Transactions\WriteOff;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A write-off. `amount` is in the invoice's currency; `base_amount` the carried base split into `allowance_used` and `expense`. VAT
 * is not adjusted by a write-off (D15 item 2): `vat_note` says so, since relief is a manual step that depends on the country.
 *
 * @mixin WriteOff
 */
final class WriteOffResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $base = Json::baseCurrency($request);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'invoice_id' => $this->invoice_id,
            'contact_id' => $this->contact_id,
            'write_off_date' => Json::date($this->write_off_date),
            'amount' => Json::money($this->amount_fc, $this->currency),
            'base_amount' => Json::money($this->amount, $base),
            'allowance_used' => Json::money($this->allowance_used, $base),
            'expense' => Json::money($this->expense, $base),
            'recovered' => Json::money($this->recovered_fc, $this->currency),
            'reason' => $this->reason,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'journal_id' => $this->journal_id,
            'reversal_journal_id' => $this->reversal_journal_id,
            'vat_note' => 'Tax already declared on this invoice is not adjusted. Relief for bad debts depends on the country and is a manual step.',
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve', 'return' => 'return', 'void' => 'void', 'reverse' => 'reverse',
            ]),
        ];
    }
}
