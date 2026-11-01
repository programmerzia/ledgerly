<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Ledger\DraftLine;
use App\Domain\Shared\Violation;
use App\Http\Support\Json;
use App\Queries\Trade\InvoicePostingPreview;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin InvoicePostingPreview */
final class InvoicePostingPreviewResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $currency = Json::baseCurrency($request);

        return [
            'valid' => $this->valid,
            'violations' => array_map(fn (Violation $v): array => $v->toArray(), $this->violations),
            'period' => $this->periodId === null ? null : ['id' => $this->periodId, 'name' => $this->periodName, 'status' => $this->periodStatus],
            'total_debit' => Json::money($this->totalDebit, $currency),
            'total_credit' => Json::money($this->totalCredit, $currency),
            'number' => null, // assigned gaplessly at posting, never predicted (13 §9)
            /** @var list<array{line_no: int, account_id: string, debit: array{amount: int, currency: string}, credit: array{amount: int, currency: string}, currency: string, fx_rate: string|null, amount_fc: int|null, description: string|null, contact_id: string|null, tax_code_id: string|null, due_date: string|null}> */
            'lines' => array_map(fn (DraftLine $l, int $i): array => [
                'line_no' => $i + 1,
                'account_id' => $l->accountId,
                'debit' => Json::money($l->debit, $currency),
                'credit' => Json::money($l->credit, $currency),
                'currency' => $l->currency ?? $currency,
                'fx_rate' => $l->fxRate,
                'amount_fc' => $l->amountFc,
                'description' => $l->description,
                'contact_id' => $l->contactId,
                'tax_code_id' => $l->taxCodeId,
                'due_date' => $l->dueDate,
            ], $this->lines, array_keys($this->lines)),
        ];
    }
}
