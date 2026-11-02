<?php

declare(strict_types=1);

namespace App\Models\Recurring;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * One occurrence of a schedule and the draft it produced. Unique per schedule and date.
 *
 * @property string $id
 * @property string $company_id
 * @property string $schedule_type recurring_invoice | recurring_journal
 * @property string $schedule_id
 * @property DateTimeImmutable $occurrence_date
 * @property string $document_type invoice | bill | journal
 * @property string $document_id
 * @property string $status drafted | submitted | submit_failed
 * @property string|null $note
 */
class RecurringRun extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['occurrence_date' => 'immutable_date'];
    }
}
