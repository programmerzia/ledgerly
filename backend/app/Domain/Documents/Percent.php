<?php

declare(strict_types=1);

namespace App\Domain\Documents;

/** Decimal-string fractions as percentages without floats: "0.160000" → "16%", "0.0725" → "7.25%". */
final class Percent
{
    public static function ofFraction(string $fraction): string
    {
        if (preg_match('/^(\d+)(?:\.(\d+))?$/', $fraction, $m) !== 1) {
            return '';
        }
        $frac = str_pad($m[2] ?? '', 2, '0');
        $whole = ltrim($m[1].substr($frac, 0, 2), '0');
        $rest = rtrim(substr($frac, 2), '0');

        return ($whole === '' ? '0' : $whole).($rest === '' ? '' : '.'.$rest).'%';
    }

    /** "2.0000" → "2", "1.5000" → "1.5": a quantity or percentage stored as a decimal string, trailing zeros dropped. */
    public static function trim(string $decimal): string
    {
        return str_contains($decimal, '.') ? rtrim(rtrim($decimal, '0'), '.') : $decimal;
    }
}
