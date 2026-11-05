<?php

declare(strict_types=1);

namespace App\Actions\Fiscal\Inputs;

use App\Domain\Fiscal\CalendarType;
use DateTimeImmutable;

final readonly class CreateFiscalYearInput
{
    /**
     * @param  CalendarType  $calendar  how the 12 regular periods are cut: calendar months, or 52 weeks in a 4-4-5 / 4-5-4 / 5-4-4 pattern
     * @param  int|null  $extraWeekPeriod  week-based only: the period (1 to 12) that takes a 53rd week; null for a 52-week year
     */
    public function __construct(
        public string $companyId,
        public DateTimeImmutable $startsOn,
        public string $name,
        public CalendarType $calendar = CalendarType::Monthly,
        public ?int $extraWeekPeriod = null,
    ) {}
}
