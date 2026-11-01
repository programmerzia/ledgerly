<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Ledger\Journal;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Journal */
final class JournalResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $currency = Json::baseCurrency($request);

        return [
            'id' => $this->id,
            'number' => $this->number,
            'status' => $this->status->value,
            'journal_type' => $this->journal_type->value,
            'journal_date' => Json::date($this->journal_date),
            'fiscal_period_id' => $this->fiscal_period_id,
            'reference' => $this->reference,
            'memo' => $this->memo,
            'total_debit' => Json::money($this->total_debit, $currency),
            'total_credit' => Json::money($this->total_credit, $currency),
            'source_type' => $this->source_type,
            'source_id' => $this->source_id,
            'reversal_of_id' => $this->reversal_of_id,
            'reversed_by_id' => $this->reversed_by_id,
            'created_by' => $this->created_by,
            'submitted_by' => $this->submitted_by,
            'approved_by' => $this->approved_by,
            'posted_by' => $this->posted_by,
            'posted_at' => Json::time($this->posted_at),
            'version' => $this->lock_version,
            // The list answers summaries; one journal comes with its lines.
            'lines' => JournalLineResource::collection($this->whenLoaded('lines')),
            'can' => Json::can($request, $this->resource, [
                'update' => 'update', 'submit' => 'submit', 'approve' => 'approve',
                'return' => 'return', 'void' => 'void', 'reverse' => 'reverse',
            ]),
        ];
    }
}
