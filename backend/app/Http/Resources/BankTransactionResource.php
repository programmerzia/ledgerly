<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Banking\BankTransaction;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A bank line coded as spend, receive or transfer. `status` is the journal's: `posted` (and the line matched) or `pending_approval`
 * (above the journal threshold, or a journal workflow applies).
 *
 * @mixin BankTransaction
 */
final class BankTransactionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'bank_account_id' => $this->bank_account_id,
            'statement_line_id' => $this->statement_line_id,
            'kind' => $this->kind,
            'to_bank_account_id' => $this->to_bank_account_id,
            'rule_id' => $this->rule_id,
            'gross' => Json::money($this->gross, $this->currency),
            'journal_id' => $this->journal_id,
            'status' => $this->relationLoaded('journal') ? $this->journal?->status->value : null,
            'journal_number' => $this->relationLoaded('journal') ? $this->journal?->number : null,
            'created_by' => $this->created_by,
        ];
    }
}
