<?php

declare(strict_types=1);

namespace App\Models\Recurring;

/**
 * A schedule of manual journals copied from a posted template.
 *
 * @property string $template_journal_id
 */
class RecurringJournal extends RecurringSchedule
{
    public function scheduleType(): string
    {
        return 'recurring_journal';
    }

    public function templateId(): string
    {
        return $this->template_journal_id;
    }
}
