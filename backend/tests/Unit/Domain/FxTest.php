<?php

declare(strict_types=1);

use App\Domain\Shared\Fx;

it('converts with a single HALF_UP rounding (D1)', function (int $fc, string $rate, int $fcScale, int $baseScale, int $expected) {
    expect(Fx::toBase($fc, $rate, $fcScale, $baseScale))->toBe($expected);
})->with([
    'plain' => [10000, '1.10000000', 2, 2, 11000],
    'half up' => [5, '0.5', 2, 2, 3],
    'half up negative (away from zero)' => [-5, '0.5', 2, 2, -3],
    'below half' => [1, '1.49999999', 2, 2, 1],
    'JPY to USD' => [1000, '0.00670000', 0, 2, 670],
    'USD to JPY' => [12345, '149.50000000', 2, 0, 18456],
    'KWD to USD' => [1000, '3.25000000', 3, 2, 325],
]);
