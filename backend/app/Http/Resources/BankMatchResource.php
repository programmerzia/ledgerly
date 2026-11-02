<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Banking\BankMatch;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin BankMatch */
final class BankMatchResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $items = $this->relationLoaded('items') ? $this->items : collect();

        return [
            'id' => $this->id,
            'bank_account_id' => $this->bank_account_id,
            /** Signed total of either side; the two sides are equal. */
            'amount' => Json::money($this->amount, (string) ($this->getAttribute('currency') ?? Json::baseCurrency($request))),
            /** @var list<string> */
            'statement_line_ids' => $items->whereNotNull('statement_line_id')->pluck('statement_line_id')->values()->all(),
            /** @var list<string> */
            'journal_line_ids' => $items->whereNotNull('journal_line_id')->pluck('journal_line_id')->values()->all(),
            /** @var list<string> */
            'settlement_ids' => $items->whereNotNull('settlement_id')->pluck('settlement_id')->unique()->values()->all(),
            'matched_by' => $this->matched_by,
            'matched_at' => Json::time($this->matched_at),
            /** Set while a finished reconciliation covers the match; it cannot be removed then. */
            'reconciliation_id' => $this->reconciliation_id,
            'can' => Json::can($request, $this->resource, ['unmatch' => 'reconcile']),
        ];
    }
}
