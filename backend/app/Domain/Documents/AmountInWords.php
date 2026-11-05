<?php

declare(strict_types=1);

namespace App\Domain\Documents;

/**
 * An amount in English words, cheque style: "One thousand two hundred thirty-four and 56/100 USD". Integer minor units
 * only; the fraction stays numeric, so there is no currency-specific wording to get wrong. Amounts of a quadrillion or more,
 * and negatives, return null (the document then simply omits the line).
 */
final class AmountInWords
{
    private const array ONES = [
        'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
        'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
    ];

    private const array TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

    private const array SCALES = ['', ' thousand', ' million', ' billion', ' trillion'];

    public static function of(int $minor, int $decimals, string $currency): ?string
    {
        if ($minor < 0 || $decimals < 0 || $decimals > 4) {
            return null;
        }
        $unit = 10 ** $decimals;
        $whole = intdiv($minor, $unit);
        if ($whole >= 1_000_000_000_000_000) {
            return null;
        }
        $words = ucfirst(self::integer($whole));
        if ($decimals > 0) {
            $words .= ' and '.str_pad((string) ($minor % $unit), $decimals, '0', STR_PAD_LEFT).'/'.$unit;
        }

        return $words.' '.$currency;
    }

    private static function integer(int $n): string
    {
        if ($n === 0) {
            return self::ONES[0];
        }
        $parts = [];
        for ($i = 0; $n > 0; $i++, $n = intdiv($n, 1000)) {
            $chunk = $n % 1000;
            if ($chunk > 0) {
                array_unshift($parts, self::hundreds($chunk).self::SCALES[$i]);
            }
        }

        return implode(' ', $parts);
    }

    private static function hundreds(int $n): string
    {
        $out = '';
        if ($n >= 100) {
            $out = self::ONES[intdiv($n, 100)].' hundred';
            $n %= 100;
            if ($n === 0) {
                return $out;
            }
            $out .= ' ';
        }
        if ($n < 20) {
            return $out.self::ONES[$n];
        }

        return $out.self::TENS[intdiv($n, 10)].($n % 10 > 0 ? '-'.self::ONES[$n % 10] : '');
    }
}
