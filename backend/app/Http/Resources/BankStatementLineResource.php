<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Banking\BankStatementLine;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A statement line, money in positive. `match_id` is set when matched; `pending_journal_id` when a bank transaction coded from this line
 * waits for approval.
 *
 * @mixin BankStatementLine
 */
final class BankStatementLineResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'statement_id' => $this->statement_id,
            'bank_account_id' => $this->bank_account_id,
            'txn_date' => Json::date($this->txn_date),
            'value_date' => Json::date($this->value_date),
            'amount' => Json::money($this->amount, $this->currency),
            'description' => $this->description,
            'reference' => $this->reference,
            'counterparty' => $this->counterparty,
            'balance_after' => $this->balance_after === null ? null : Json::money($this->balance_after, $this->currency),
            'status' => $this->status,
            'match_id' => $this->getAttribute('match_id'),
            'pending_journal_id' => $this->getAttribute('pending_journal_id'),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['match' => 'reconcile', 'code' => 'codeLines']),
        ];
    }
}
