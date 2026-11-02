<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Recurring\RecurringInvoice;
use App\Models\Recurring\RecurringJournal;
use App\Models\Recurring\RecurringRun;
use App\Models\Recurring\RecurringSchedule;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A recurring invoice/bill or journal schedule. `generated_count` and `last_run` come from `recurring_runs`.
 *
 * @mixin RecurringSchedule
 */
final class RecurringScheduleResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $schedule = $this->resource;
        $documentType = $schedule instanceof RecurringInvoice ? $schedule->template()->first()?->kind->documentType() : 'journal';
        $runs = RecurringRun::query()->where('schedule_type', $schedule->scheduleType())->where('schedule_id', $schedule->id);

        return [
            'id' => $this->id,
            'name' => $this->name,
            'document_type' => $documentType,
            'template_id' => $schedule instanceof RecurringJournal || $schedule instanceof RecurringInvoice ? $schedule->templateId() : null,
            'frequency' => $this->frequency->value,
            'next_date' => Json::date($this->next_date),
            'end_date' => Json::date($this->end_date),
            'owner_id' => $this->owner_id,
            'is_active' => $this->is_active,
            'last_run_on' => Json::date($this->last_run_on),
            'last_error' => $this->last_error,
            'generated_count' => $runs->count(),
            'version' => $this->lock_version,
            'can' => Json::can($request, $this->resource, ['update' => 'update', 'pause' => 'pause', 'resume' => 'resume']),
        ];
    }
}
