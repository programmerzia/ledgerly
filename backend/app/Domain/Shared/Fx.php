<?php

declare(strict_types=1);

namespace App\Domain\Shared;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/** Currency conversion with exact decimals and a single HALF_UP rounding (13 §23 D1). */
final class Fx
{
    /**
     * @param  int  $amountFc  minor units of the foreign currency (signed)
     * @param  string  $rate  base units per 1 foreign unit, decimal string
     * @param  int  $fcScale  minor-unit digits of the foreign currency
     * @param  int  $baseScale  minor-unit digits of the base currency
     * @return int base minor units
     */
    public static function toBase(int $amountFc, string $rate, int $fcScale, int $baseScale): int
    {
        return BigDecimal::of($amountFc)
            ->multipliedBy(BigDecimal::of($rate))
            ->multipliedBy(BigDecimal::one()->withPointMovedRight($baseScale - $fcScale))
            ->toScale(0, RoundingMode::HalfUp)
            ->toInt();
    }
}
