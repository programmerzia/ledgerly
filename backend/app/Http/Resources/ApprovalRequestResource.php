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
        return [
            'id' => $this->id,
            'document_type' => $this->document_type,
            'document_id' => $this->document_id,
            'step' => $this->step,
            'slot' => $this->slot,
            'role' => $this->role,
            'requested_by' => $this->requested_by,
            'requested_at' => Json::time($this->requested_at),
            'document' => $this->document($request),
        ];
    }

    /** @return array<string, mixed> */
    private function document(Request $request): array
    {
        $amount = Json::money((int) $this->getAttribute('document_amount'), Json::baseCurrency($request));
        $invoice = $this->invoice;
        if ($invoice !== null) {
            return [
                'id' => $invoice->id,
                'kind' => $invoice->kind->value,
                'number' => $invoice->number,
                'issue_date' => Json::date($invoice->issue_date),
                'contact_id' => $invoice->contact_id,
                'reference' => $invoice->reference,
                'memo' => $invoice->memo,
                'amount' => $amount,
                'created_by' => $invoice->created_by,
                'submitted_by' => $invoice->submitted_by,
                'version' => $invoice->lock_version,
            ];
        }
        $journal = $this->journal;

        return [
            'id' => $journal->id,
            'journal_type' => $journal->journal_type->value,
            'journal_date' => Json::date($journal->journal_date),
            'reference' => $journal->reference,
            'memo' => $journal->memo,
            'amount' => $amount,
            'created_by' => $journal->created_by,
            'submitted_by' => $journal->submitted_by,
            'version' => $journal->lock_version,
        ];
    }
}
