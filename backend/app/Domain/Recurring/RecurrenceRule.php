<?php

declare(strict_types=1);

namespace App\Domain\Recurring;

use DateTimeImmutable;

/**
 * Dates of a recurring schedule. Pure. The anchor day is the day of the month the schedule started on: a month
 * too short for it uses its last day, and the next month goes back to the anchor (31 Jan, 28 Feb, 31 Mar), so
 * dates never drift earlier the way "add one month to the last date" would.
 */
final class RecurrenceRule
{
    /** The occurrence after $date. */
    public static function after(DateTimeImmutable $date, Frequency $frequency, int $anchorDay): DateTimeImmutable
    {
        $first = $date->modify('first day of this month')->modify('+'.$frequency->months().' months');
        $last = (int) $first->format('t');

        return $first->setDate((int) $first->format('Y'), (int) $first->format('n'), min($anchorDay, $last));
    }

    /**
     * Every occurrence from $next up to $asOf (and $end, when set), oldest first, at most $cap of them. The caller
     * stores the date after the last one it handled as the schedule's new next date.
     *
     * @return list<DateTimeImmutable>
     */
    public static function due(DateTimeImmutable $next, Frequency $frequency, int $anchorDay, DateTimeImmutable $asOf, ?DateTimeImmutable $end, int $cap): array
    {
        $dates = [];
        while ($next <= $asOf && ($end === null || $next <= $end) && count($dates) < $cap) {
            $dates[] = $next;
            $next = self::after($next, $frequency, $anchorDay);
        }

        return $dates;
    }
}
