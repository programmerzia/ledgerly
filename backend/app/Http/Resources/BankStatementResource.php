<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Banking\BankStatement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin BankStatement */
final class BankStatementResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'bank_account_id' => $this->bank_account_id,
            'period_from' => Json::date($this->period_from),
            'period_to' => Json::date($this->period_to),
            'opening_balance' => $this->opening_balance === null ? null : Json::money($this->opening_balance, $this->currency),
            'closing_balance' => $this->closing_balance === null ? null : Json::money($this->closing_balance, $this->currency),
            'source' => $this->source,
            'file_name' => $this->file_name,
            'line_count' => $this->line_count,
            /** Lines in the file that were already imported and so added nothing. */
            'duplicates_skipped' => $this->duplicates_skipped,
            /** @var list<string> $warnings For example statement_balance_mismatch, balances_not_provided. */
            'warnings' => $this->warnings,
            'imported_by' => $this->imported_by,
            'imported_at' => Json::time($this->imported_at),
        ];
    }
}
