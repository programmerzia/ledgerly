<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Banking\BankAccount;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A bank or cash account: its GL account, currency, saved CSV mapping, the book balance (posted ledger, account currency) and the
 * statement lines still waiting for a match.
 *
 * @mixin BankAccount
 */
final class BankAccountResource extends JsonResource
{
    /** @param array<string, array{book_balance: int, unreconciled_count: int}> $figures */
    public static function withFigures(BankAccount $account, array $figures): self
    {
        $r = new self($account);
        $r->additional = [];
        $account->setAttribute('figures', $figures[$account->id] ?? ['book_balance' => 0, 'unreconciled_count' => 0]);

        return $r;
    }

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var array{book_balance: int, unreconciled_count: int}|null $figures */
        $figures = $this->getAttribute('figures');

        return [
            'id' => $this->id,
            'name' => $this->name,
            'account_id' => $this->account_id,
            'currency' => $this->currency,
            'kind' => $this->kind,
            'bank_name' => $this->bank_name,
            'account_number_masked' => $this->account_number_masked,
            'iban' => $this->iban,
            'swift' => $this->swift,
            /** @var array<string, mixed>|null $import_mapping The saved CSV column mapping. */
            'import_mapping' => $this->import_mapping,
            'last_statement_balance' => $this->last_statement_balance === null ? null : Json::money($this->last_statement_balance, $this->currency),
            'last_statement_date' => Json::date($this->last_statement_date),
            'book_balance' => $figures === null ? null : Json::money((int) $figures['book_balance'], (string) $this->currency),
            /** @var int|null Statement lines still unmatched. */
            'unreconciled_count' => $figures === null ? null : $figures['unreconciled_count'],
            'is_active' => $this->is_active,
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'manageAccounts', 'import' => 'import', 'reconcile' => 'reconcile']),
        ];
    }
}
