<?php

declare(strict_types=1);

namespace App\Domain\Fx;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/** Cross rates from a single-base feed such as the ECB's, in exact decimals, rounded once to the stored scale (D1). */
final class CrossRates
{
    public const int SCALE = 8;

    /**
     * Base units per 1 unit of $from (the `rate` convention of exchange_rates), or null when the feed lacks either currency.
     * from→to = (to per base) / (from per base), e.g. USD→EUR with EUR-based USD 1.25 = 1 / 1.25 = 0.8.
     */
    public static function rate(ProviderRates $feed, string $from, string $to): ?string
    {
        $fromPerBase = $feed->perBase($from);
        $toPerBase = $feed->perBase($to);
        if ($fromPerBase === null || $toPerBase === null) {
            return null;
        }
        $divisor = BigDecimal::of($fromPerBase);
        if (! $divisor->isPositive()) {
            return null;
        }

        return (string) BigDecimal::of($toPerBase)->dividedBy($divisor, self::SCALE, RoundingMode::HalfUp);
    }

    /** The reciprocal of a stored rate, at the stored scale. */
    public static function inverse(string $rate): string
    {
        return (string) BigDecimal::one()->dividedBy(BigDecimal::of($rate), self::SCALE, RoundingMode::HalfUp);
    }
}
