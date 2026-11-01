<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Workflow\ApprovalRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ApprovalRequest */
final class ApprovalRequestResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $journal = $this->journal;

        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            'document_id' => $this->document_id,
            'step' => $this->step,
            'slot' => $this->slot,
            'role' => $this->role,
            'requested_by' => $this->requested_by,
            'requested_at' => Json::time($this->requested_at),
            'document' => [
                'id' => $journal->id,
                'journal_type' => $journal->journal_type->value,
                'journal_date' => Json::date($journal->journal_date),
                'reference' => $journal->reference,
                'memo' => $journal->memo,
                'amount' => Json::money((int) $this->getAttribute('document_amount'), Json::baseCurrency($request)),
                'created_by' => $journal->created_by,
                'submitted_by' => $journal->submitted_by,
                'version' => $journal->lock_version,
            ],
        ];
    }
}
