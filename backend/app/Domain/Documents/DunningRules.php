<?php

declare(strict_types=1);

namespace App\Domain\Documents;

use DateTimeImmutable;

/**
 * When an overdue invoice is due its next reminder (plan 3c.7). A stage is "days after the due date". An invoice that is N days
 * overdue is due the highest stage whose days are at most N and no more than CATCH_UP_DAYS behind N, and which has not been
 * used for this invoice yet. The catch-up window forgives a day or two when the scheduler was down, but it also means a company
 * that switches reminders on does not send "30 days overdue" for every old invoice at once: a stage whose moment has passed
 * is simply gone. At most one stage is due per invoice per run.
 */
final class DunningRules
{
    public const int CATCH_UP_DAYS = 3;

    /** Whole days from the due date to $on; negative before it. */
    public static function daysOverdue(DateTimeImmutable $due, DateTimeImmutable $on): int
    {
        return (int) $due->setTime(0, 0)->diff($on->setTime(0, 0))->format('%r%a');
    }

    /**
     * @param  array<string, int>  $stages  stage id → days after due
     * @param  list<string>  $used  stage ids already sent for this invoice
     * @return string|null the stage id to send now
     */
    public static function due(int $daysOverdue, array $stages, array $used): ?string
    {
        $pick = null;
        $pickDays = 0;
        foreach ($stages as $id => $days) {
            if (in_array($id, $used, true) || $days > $daysOverdue || $daysOverdue - $days > self::CATCH_UP_DAYS) {
                continue;
            }
            if ($days > $pickDays) {
                $pick = (string) $id;
                $pickDays = $days;
            }
        }

        return $pick;
    }
}
