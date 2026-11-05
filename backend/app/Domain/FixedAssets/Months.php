<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

use DateTimeImmutable;

/** Calendar-month arithmetic on `Y-m-d` strings. Depreciation works in whole months (D15.1). */
final class Months
{
    /** Months since year 0: a comparable index for the month a date falls in. */
    public static function index(string $date): int
    {
        return (int) substr($date, 0, 4) * 12 + (int) substr($date, 5, 2) - 1;
    }

    public static function endOf(string $date): string
    {
        return (new DateTimeImmutable($date))->modify('last day of this month')->format('Y-m-d');
    }

    public static function startOf(string $date): string
    {
        return substr($date, 0, 7).'-01';
    }

    /** The last day of the month before the one $date falls in. */
    public static function endOfPrevious(string $date): string
    {
        return (new DateTimeImmutable(self::startOf($date)))->modify('-1 day')->format('Y-m-d');
    }

    /**
     * Month ends from the month of $firstMonthDate through the month of $lastDate, inclusive; empty when the first is after the last.
     *
     * @return list<string>
     */
    public static function endsBetween(string $firstMonthDate, string $lastDate): array
    {
        $out = [];
        for ($i = self::index($firstMonthDate); $i <= self::index($lastDate); $i++) {
            $out[] = self::endOf(sprintf('%04d-%02d-01', intdiv($i, 12), $i % 12 + 1));
        }

        return $out;
    }

    /** Whether $date is the last day of its month. */
    public static function isMonthEnd(string $date): bool
    {
        return $date === self::endOf($date);
    }
}
