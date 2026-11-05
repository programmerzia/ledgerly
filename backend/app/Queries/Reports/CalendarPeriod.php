<?php

declare(strict_types=1);

namespace App\Queries\Reports;

/** One fiscal period as the reports see it. Dates are YYYY-MM-DD. */
final readonly class CalendarPeriod
{
    public function __construct(
        public string $id,
        public string $fiscalYearId,
        public int $number,
        public string $name,
        public string $kind,
        public string $startsOn,
        public string $endsOn,
        public string $yearStartsOn,
        public string $yearEndsOn,
        /** The year is cut in whole weeks (4-4-5 and the like), so "the same time last year" is the same period number, not the same calendar dates. */
        public bool $weekBased = false,
    ) {}

    public function isRegular(): bool
    {
        return $this->kind === 'regular';
    }
}
