<?php

declare(strict_types=1);

namespace App\Support\Reports\Export;

/** Integer minor units to the decimal text an export shows. No floating point is involved. */
final class Amounts
{
    public static function text(int $minor, int $decimals): string
    {
        $sign = $minor < 0 ? '-' : '';
        $digits = (string) abs($minor);
        if ($decimals === 0) {
            return $sign.$digits;
        }
        $digits = str_pad($digits, $decimals + 1, '0', STR_PAD_LEFT);

        return $sign.substr($digits, 0, -$decimals).'.'.substr($digits, -$decimals);
    }

    /** A spreadsheet cell can only hold a double; ledgers stay in integers and this is for display. */
    public static function number(int $minor, int $decimals): float
    {
        return $minor / (10 ** $decimals);
    }

    /** Text that a spreadsheet would read as a formula gets a leading apostrophe (OWASP CSV injection). */
    public static function safe(string $text): string
    {
        return $text !== '' && str_contains("=+-@\t\r", $text[0]) ? "'".$text : $text;
    }
}
