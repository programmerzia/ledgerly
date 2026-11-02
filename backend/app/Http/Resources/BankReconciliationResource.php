<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Banking\BankReconciliation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A reconciliation of one statement. While `in_progress`, `report` is the live calculation (statement closing balance = book balance
 * adjusted for unmatched items; `difference` must be 0 to finish); once `finished` it is the frozen snapshot.
 *
 * @mixin BankReconciliation
 */
final class BankReconciliationResource extends JsonResource
{
    /** @param array<string, mixed>|null $live */
    public static function withLive(BankReconciliation $r, ?array $live): self
    {
        $r->setAttribute('live_report', $live);

        return new self($r);
    }

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var array<string, mixed>|null $live */
        $live = $this->getAttribute('live_report');
        $finished = $this->status === 'finished';

        return [
            'id' => $this->id,
            'bank_account_id' => $this->bank_account_id,
            'statement_id' => $this->statement_id,
            'as_of' => Json::date($this->as_of),
            'status' => $this->status,
            'book_balance' => $this->book_balance,
            'statement_balance' => $this->statement_balance,
            'difference' => $this->difference,
            /** @var array<string, mixed>|null $report */
            'report' => $finished ? $this->report : $live,
            'finished_by' => $this->finished_by,
            'finished_at' => Json::time($this->finished_at),
            'reopened_by' => $this->reopened_by,
            'reopened_at' => Json::time($this->reopened_at),
            'reopen_reason' => $this->reopen_reason,
            'reopen_count' => $this->reopen_count,
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['finish' => 'reconcile', 'reopen' => 'reconcile']),
        ];
    }
}
