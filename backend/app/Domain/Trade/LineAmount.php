<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/** A line's net amount: quantity × unit price × (1 − discount%), rounded once, HALF_UP, to the currency's minor unit. */
final class LineAmount
{
    /**
     * @param  string  $quantity  decimal string, up to 6 decimals
     * @param  int  $unitPrice  minor units
     * @param  string  $discountPct  0..100, decimal string
     */
    public static function net(string $quantity, int $unitPrice, string $discountPct = '0'): int
    {
        $kept = BigDecimal::of('100')->minus(BigDecimal::of($discountPct));

        return BigDecimal::of($quantity)->multipliedBy($unitPrice)->multipliedBy($kept)->dividedBy('100', 0, RoundingMode::HalfUp)->toInt();
    }
}
