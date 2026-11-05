<?php

declare(strict_types=1);

namespace App\Domain\Fiscal;

use App\Domain\Shared\DomainRuleViolation;
use DateTimeImmutable;

/**
 * Builds a fiscal year: 12 regular periods plus the adjustment period (D7). Pure PHP.
 *
 * Monthly: calendar months from the first of a month. Week-based (4-4-5, 4-5-4, 5-4-4): 52 weeks = 364 days from any start date, each
 * period a whole number of weeks. A 53-week year (371 days) is chosen, not computed: the caller names the period that takes the extra week.
 * The adjustment period ends on the same day as the last regular period either way. A period is always a date range; nothing downstream
 * may assume it is a calendar month.
 */
final class FiscalCalendar
{
    /** @return list<PlannedPeriod> */
    public static function plan(CalendarType $type, DateTimeImmutable $startsOn, ?int $extraWeekPeriod = null): array
    {
        if (! $type->isWeekBased()) {
            if ($extraWeekPeriod !== null) {
                throw DomainRuleViolation::single('fiscal_extra_week_invalid', 'Only a week-based calendar has a 53rd week.');
            }

            return self::monthly($startsOn);
        }

        return self::weekBased($type, $startsOn, $extraWeekPeriod);
    }

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

        return self::withAdjustment($periods);
    }

    /**
     * @param  int|null  $extraWeekPeriod  1 to 12: the period that has one more week, making the year 53 weeks; null for 52 weeks
     * @return list<PlannedPeriod>
     */
    public static function weekBased(CalendarType $type, DateTimeImmutable $startsOn, ?int $extraWeekPeriod = null): array
    {
        if (! $type->isWeekBased()) {
            throw new \InvalidArgumentException('weekBased() needs a week-based calendar type.');
        }
        if ($extraWeekPeriod !== null && ($extraWeekPeriod < 1 || $extraWeekPeriod > 12)) {
            throw DomainRuleViolation::single('fiscal_extra_week_invalid', 'The extra week goes in a period from 1 to 12.');
        }

        $pattern = $type->pattern();
        $periods = [];
        $start = $startsOn;
        for ($i = 0; $i < 12; $i++) {
            $weeks = $pattern[$i % 3] + ($extraWeekPeriod === $i + 1 ? 1 : 0);
            $end = $start->modify('+'.($weeks * 7 - 1).' days');
            $periods[] = new PlannedPeriod($i + 1, sprintf('P%02d %s', $i + 1, $start->format('j M Y')), $start, $end, PeriodKind::Regular);
            $start = $end->modify('+1 day');
        }

        return self::withAdjustment($periods);
    }

    /**
     * @param  list<PlannedPeriod>  $regular
     * @return list<PlannedPeriod>
     */
    private static function withAdjustment(array $regular): array
    {
        $yearEnd = $regular[11]->endsOn;
        $regular[] = new PlannedPeriod(13, 'Adjustments '.$yearEnd->format('Y-m-d'), $yearEnd, $yearEnd, PeriodKind::Adjustment);

        return $regular;
    }
}
