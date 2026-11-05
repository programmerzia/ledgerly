<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

use Brick\Math\BigInteger;
use Brick\Math\RoundingMode;

/**
 * The one rounding rule of fixed assets: integer minor units, a x b / c rounded HALF_UP (halves away from zero), computed
 * exactly with big integers so a large cost times a rate cannot overflow. Rates are integer basis points, never floats.
 */
final class Round
{
    public static function mulDiv(int $a, int $b, int $c): int
    {
        if ($c <= 0) {
            throw new \InvalidArgumentException('The divisor must be positive.');
        }

        return BigInteger::of($a)->multipliedBy($b)->dividedBy($c, RoundingMode::HalfUp)->toInt();
    }
}
