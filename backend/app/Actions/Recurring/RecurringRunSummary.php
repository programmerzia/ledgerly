<?php

declare(strict_types=1);

namespace App\Actions\Recurring;

use App\Models\Recurring\RecurringRun;

/** What one run did: the occurrences it created, and the schedules it could not advance (schedule id → reason code). */
final readonly class RecurringRunSummary
{
    /**
     * @param  list<RecurringRun>  $runs
     * @param  array<string, string>  $failures
     */
    public function __construct(public array $runs, public array $failures) {}
}
