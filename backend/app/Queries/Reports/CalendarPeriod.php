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
    ) {}

    public function isRegular(): bool
    {
        return $this->kind === 'regular';
    }
}
