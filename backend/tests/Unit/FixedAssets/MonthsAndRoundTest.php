<?php

declare(strict_types=1);

use App\Domain\FixedAssets\Months;
use App\Domain\FixedAssets\Round;

it('does month arithmetic on dates', function (): void {
    expect(Months::endOf('2026-02-10'))->toBe('2026-02-28')->and(Months::endOf('2028-02-01'))->toBe('2028-02-29')
        ->and(Months::startOf('2026-03-20'))->toBe('2026-03-01')->and(Months::endOfPrevious('2026-03-20'))->toBe('2026-02-28')
        ->and(Months::endOfPrevious('2026-01-05'))->toBe('2025-12-31')
        ->and(Months::isMonthEnd('2026-03-31'))->toBeTrue()->and(Months::isMonthEnd('2026-03-30'))->toBeFalse()
        ->and(Months::index('2026-03-20') - Months::index('2025-12-01'))->toBe(3)
        ->and(Months::endsBetween('2026-01-15', '2026-03-02'))->toBe(['2026-01-31', '2026-02-28', '2026-03-31'])
        ->and(Months::endsBetween('2026-04-01', '2026-03-31'))->toBe([]);
});

it('rounds a x b / c half up, exactly, without overflowing', function (): void {
    expect(Round::mulDiv(100, 1, 3))->toBe(33)->and(Round::mulDiv(200, 1, 3))->toBe(67)->and(Round::mulDiv(5, 1, 2))->toBe(3)
        ->and(Round::mulDiv(0, 7, 3))->toBe(0)
        // 9e15 minor units times 10,000 basis points would overflow a 64-bit integer if multiplied first.
        ->and(Round::mulDiv(9_000_000_000_000_000, 10000, 120000))->toBe(750_000_000_000_000);
    expect(fn () => Round::mulDiv(1, 1, 0))->toThrow(InvalidArgumentException::class);
});
