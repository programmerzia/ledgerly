<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/** Quantities are decimal strings with up to six places, never floats (13 §16). */
final class Quantity
{
    public const int SCALE = 6;

    public static function normal(string $q): string
    {
        return BigDecimal::of($q)->toScale(self::SCALE, RoundingMode::Unnecessary)->__toString();
    }

    public static function isZero(string $q): bool
    {
        return BigDecimal::of($q)->isZero();
    }

    public static function add(string $a, string $b): string
    {
        return self::normal(BigDecimal::of($a)->plus($b)->__toString());
    }

    /** $a − $b, never below zero. */
    public static function remaining(string $a, string $b): string
    {
        $d = BigDecimal::of($a)->minus($b);

        return self::normal($d->isNegative() ? '0' : $d->__toString());
    }

    public static function exceeds(string $a, string $b): bool
    {
        return BigDecimal::of($a)->isGreaterThan($b);
    }

    /** $base increased by $pct percent, exactly. */
    public static function withTolerance(string $base, string $pct): BigDecimal
    {
        return BigDecimal::of($base)->multipliedBy(BigDecimal::of('100')->plus($pct))->dividedByExact('100');
    }
}
