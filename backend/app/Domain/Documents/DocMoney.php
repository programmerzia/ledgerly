<?php

declare(strict_types=1);

namespace App\Domain\Documents;

use App\Domain\Shared\FormatPreferences;

/**
 * Integer minor units as the text a printed document shows: grouped thousands, the currency's own number of decimals, a
 * real minus sign. No floating point anywhere.
 */
final readonly class DocMoney
{
    public function __construct(public string $currency, public int $decimals, public ?FormatPreferences $formats = null) {}

    /** "1,234.50", or the company's own separators when it has a format (plan 3c.26b). */
    public function plain(int $minor): string
    {
        if ($this->formats !== null) {
            return $this->formats->number($minor, $this->decimals);
        }
        $sign = $minor < 0 ? '-' : '';
        $digits = (string) abs($minor);
        if ($this->decimals > 0) {
            $digits = str_pad($digits, $this->decimals + 1, '0', STR_PAD_LEFT);
            $whole = substr($digits, 0, -$this->decimals);
            $fraction = '.'.substr($digits, -$this->decimals);
        } else {
            $whole = $digits;
            $fraction = '';
        }

        return $sign.preg_replace('/\B(?=(\d{3})+(?!\d))/', ',', $whole).$fraction;
    }

    /** "USD 1,234.50" */
    public function withCode(int $minor): string
    {
        return $this->currency.' '.$this->plain($minor);
    }

    public function words(int $minor): ?string
    {
        return AmountInWords::of($minor, $this->decimals, $this->currency);
    }
}
