<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use Brick\Math\BigDecimal;
use Brick\Math\Exception\MathException;
use Brick\Math\Exception\RoundingNecessaryException;
use Brick\Math\RoundingMode;

/**
 * Exact decimal text to integer minor units; never a float. Locales say which mark is the decimal point:
 *   us    1,234.56   (',' groups thousands, '.' decimal)
 *   eu    1.234,56   ('.' groups thousands, ',' decimal)
 *   plain 1234.56 or 1234,56 (no grouping; a single ',' or '.' is the decimal point)
 * A sign may lead ("-12.00", "+12.00") or trail ("12.00-"), and "(12.00)" is negative. More decimals than the
 * currency has is an error unless the extra digits are zeros.
 */
final class AmountParser
{
    public static function parse(string $raw, string $locale, int $scale = 2): int
    {
        $s = trim(str_replace(["\u{00A0}", ' ', "'"], '', $raw));
        if ($s === '') {
            throw new \InvalidArgumentException('The amount is empty.');
        }
        $negative = false;
        if (str_starts_with($s, '(') && str_ends_with($s, ')')) {
            $negative = true;
            $s = substr($s, 1, -1);
        }
        if (str_ends_with($s, '-')) {
            $negative = ! $negative;
            $s = substr($s, 0, -1);
        }
        if ($s !== '' && ($s[0] === '-' || $s[0] === '+')) {
            $negative = $s[0] === '-' ? ! $negative : $negative;
            $s = substr($s, 1);
        }
        $normalised = match ($locale) {
            'us' => preg_match('/^(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/', $s) === 1 ? str_replace(',', '', $s) : null,
            'eu' => preg_match('/^(\d{1,3}(\.\d{3})+|\d+)(,\d+)?$/', $s) === 1 ? str_replace(',', '.', str_replace('.', '', $s)) : null,
            'plain' => preg_match('/^\d+([.,]\d+)?$/', $s) === 1 ? str_replace(',', '.', $s) : null,
            default => throw new \InvalidArgumentException("Unknown number locale {$locale}."),
        };
        if ($normalised === null) {
            throw new \InvalidArgumentException("'{$raw}' is not a valid amount for the {$locale} number format.");
        }
        try {
            $int = BigDecimal::of($normalised)->withPointMovedRight($scale)->toScale(0, RoundingMode::Unnecessary)->toBigInteger();
        } catch (RoundingNecessaryException) {
            throw new \InvalidArgumentException("'{$raw}' has more than {$scale} decimals.");
        } catch (MathException) {
            throw new \InvalidArgumentException("'{$raw}' is not a valid amount.");
        }
        if ($int->abs()->isGreaterThan(99_999_999_999_999)) {
            throw new \InvalidArgumentException("'{$raw}' is out of range.");
        }

        return ($negative ? $int->negated() : $int)->toInt();
    }
}
