<?php

declare(strict_types=1);

namespace App\Domain\Fiscal;

/**
 * How a fiscal year is cut into its 12 regular periods (PRD §4.3). `Monthly` follows calendar months. The others are week-based: 52 whole
 * weeks (364 days) in a 4-4-5, 4-5-4 or 5-4-4 pattern, repeated for each of the four quarters.
 */
enum CalendarType: string
{
    case Monthly = 'monthly';
    case Weeks445 = '4-4-5';
    case Weeks454 = '4-5-4';
    case Weeks544 = '5-4-4';

    public function isWeekBased(): bool
    {
        return $this !== self::Monthly;
    }

    /** @return list<int> weeks in the three periods of one quarter; empty for a monthly calendar */
    public function pattern(): array
    {
        return match ($this) {
            self::Monthly => [],
            self::Weeks445 => [4, 4, 5],
            self::Weeks454 => [4, 5, 4],
            self::Weeks544 => [5, 4, 4],
        };
    }

    public function label(): string
    {
        return match ($this) {
            self::Monthly => 'Calendar months',
            self::Weeks445, self::Weeks454, self::Weeks544 => $this->value.' weeks',
        };
    }
}
