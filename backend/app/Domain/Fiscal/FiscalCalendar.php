<?php

declare(strict_types=1);

namespace App\Domain\Fiscal;

use App\Domain\Shared\DomainRuleViolation;
use DateTimeImmutable;

/** Builds a fiscal year: 12 monthly regular periods plus the adjustment period (D7). */
final class FiscalCalendar
{
    /** @return list<PlannedPeriod> */
    public static function monthly(DateTimeImmutable $startsOn): array
    {
        if ($startsOn->format('j') !== '1') {
            throw DomainRuleViolation::single('fiscal_year_start_invalid', 'A fiscal year must start on the first day of a month.');
        }

        $periods = [];
        for ($i = 0; $i < 12; $i++) {
            $start = $startsOn->modify("+{$i} months");
            $end = $start->modify('last day of this month');
            $periods[] = new PlannedPeriod($i + 1, $start->format('M Y'), $start, $end, PeriodKind::Regular);
        }

        $yearEnd = $periods[11]->endsOn;
        $periods[] = new PlannedPeriod(13, 'Adjustments '.$yearEnd->format('Y-m-d'), $yearEnd, $yearEnd, PeriodKind::Adjustment);

        return $periods;
    }
}
