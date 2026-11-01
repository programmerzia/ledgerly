<?php

declare(strict_types=1);

use App\Domain\Fx\CrossRates;
use App\Domain\Fx\ProviderRates;

// EUR-based feed: 1 EUR = 1.25 USD = 0.8 GBP = 160 JPY = 3 XXX.
$feed = new ProviderRates('2026-03-31', 'EUR', ['USD' => '1.25', 'GBP' => '0.8', 'JPY' => '160', 'XXX' => '3']);

it('derives base units per foreign unit from a single-base feed, exactly', function (string $from, string $to, ?string $expected) use ($feed) {
    expect(CrossRates::rate($feed, $from, $to))->toBe($expected);
})->with([
    'USD to EUR' => ['USD', 'EUR', '0.80000000'],     // 1 / 1.25
    'EUR to USD' => ['EUR', 'USD', '1.25000000'],
    'GBP to USD' => ['GBP', 'USD', '1.56250000'],     // 1.25 / 0.8
    'USD to GBP' => ['USD', 'GBP', '0.64000000'],     // 0.8 / 1.25
    'JPY to USD' => ['JPY', 'USD', '0.00781250'],     // 1.25 / 160
    'rounds HALF_UP at 8 decimals' => ['XXX', 'EUR', '0.33333333'],
    'rounds up the half' => ['XXX', 'GBP', '0.26666667'],   // 0.8 / 3 = 0.266666666...
    'unquoted currency' => ['ZZZ', 'USD', null],
]);

it('inverts a stored rate at the stored scale', function () {
    expect(CrossRates::inverse('0.8'))->toBe('1.25000000')->and(CrossRates::inverse('3'))->toBe('0.33333333');
});
