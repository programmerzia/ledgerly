<?php

declare(strict_types=1);

namespace App\Http\Requests\Recurring;

/** A recurring journal: the template is a posted manual journal. */
final class RecurringJournalRequest extends RecurringScheduleRequest
{
    protected function templateTable(): string
    {
        return 'journals';
    }
}
