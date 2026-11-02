<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Recurring\RecurringRun;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One occurrence of a schedule and its draft. `status`: drafted (waiting to be submitted), submitted (waiting for
 * approval, or posted by a workflow-free company's person), submit_failed (kept as a draft; `note` says why).
 *
 * @mixin RecurringRun
 */
final class RecurringRunResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'schedule_type' => $this->schedule_type,
            'schedule_id' => $this->schedule_id,
            'occurrence_date' => Json::date($this->occurrence_date),
            'document_type' => $this->document_type,
            'document_id' => $this->document_id,
            'status' => $this->status,
            'note' => $this->note,
        ];
    }
}
