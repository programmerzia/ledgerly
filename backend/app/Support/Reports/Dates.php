<?php

declare(strict_types=1);

namespace App\Support\Reports;

use DateTimeImmutable;

/** Date arithmetic on YYYY-MM-DD strings, which is how dates travel through the reports. */
final class Dates
{
    public static function before(string $date): string
    {
        return self::make($date)->modify('-1 day')->format('Y-m-d');
    }

    public static function after(string $date): string
    {
        return self::make($date)->modify('+1 day')->format('Y-m-d');
    }

    /** The same calendar day one year earlier; the last day of a month maps to the last day of that month. */
    public static function yearBefore(string $date): string
    {
        $d = self::make($date);
        $lastDay = $d->format('Y-m-d') === $d->modify('last day of this month')->format('Y-m-d');
        $back = $d->modify('first day of this month')->modify('-1 year');

        return $lastDay
            ? $back->modify('last day of this month')->format('Y-m-d')
            : $back->modify('+'.((int) $d->format('j') - 1).' days')->format('Y-m-d');
    }

    public static function days(string $from, string $to): int
    {
        return (int) self::make($from)->diff(self::make($to))->days;
    }

    public static function make(string $date): DateTimeImmutable
    {
        return new DateTimeImmutable($date.' 00:00:00 UTC');
    }
}
