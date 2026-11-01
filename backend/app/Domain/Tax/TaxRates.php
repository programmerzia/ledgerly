<?php

declare(strict_types=1);

namespace App\Domain\Tax;

use DateTimeImmutable;

/** Rate lookup by effective date. Periods of one tax code never overlap (the database enforces it too). */
final class TaxRates
{
    /**
     * The rate in force on $date, or null when none is (the caller decides whether that is an error).
     *
     * @param  list<TaxRatePeriod>  $periods
     */
    public static function on(array $periods, DateTimeImmutable $date): ?string
    {
        foreach ($periods as $period) {
            if ($period->covers($date)) {
                return $period->rate;
            }
        }

        return null;
    }
}
