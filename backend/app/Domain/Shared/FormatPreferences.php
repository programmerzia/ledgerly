<?php

declare(strict_types=1);

namespace App\Domain\Shared;

use DateTimeInterface;

/**
 * How a company's dates and numbers read on screens and printed documents (plan 3c.26b). One helper for both: the PDFs, the report PDFs and
 * the API's hint to the SPA all come from here. It changes the *text* only. Money stays integer minor units everywhere else, and machine
 * outputs (CSV, XLSX values, JSON) are never formatted: ISO dates, plain decimals. No translation, no currency symbols. Pure PHP.
 *
 * A company stores a choice or nothing; nothing means "the usual way in the company's country" (`forCountry`).
 */
final readonly class FormatPreferences
{
    /** @var array<string, array{label: string, pattern: string}> key → PHP date() pattern */
    public const array DATE_FORMATS = [
        'dmy' => ['label' => '31/12/2026', 'pattern' => 'd/m/Y'],
        'mdy' => ['label' => '12/31/2026', 'pattern' => 'm/d/Y'],
        'ymd' => ['label' => '2026-12-31', 'pattern' => 'Y-m-d'],
        'd_mon_y' => ['label' => '31 Dec 2026', 'pattern' => 'd M Y'],
    ];

    /** @var array<string, array{label: string, group: string, decimal: string}> */
    public const array NUMBER_FORMATS = [
        'comma_dot' => ['label' => '1,234,567.89', 'group' => ',', 'decimal' => '.'],
        'dot_comma' => ['label' => '1.234.567,89', 'group' => '.', 'decimal' => ','],
        'space_comma' => ['label' => '1 234 567,89', 'group' => "\u{202F}", 'decimal' => ','],
        'apostrophe_dot' => ['label' => "1\u{2019}234\u{2019}567.89", 'group' => "\u{2019}", 'decimal' => '.'],
    ];

    public const string DEFAULT_DATE = 'd_mon_y';

    public const string DEFAULT_NUMBER = 'comma_dot';

    /** Countries that write the month first. */
    private const array MONTH_FIRST = ['US', 'PH', 'CA'];

    /** Countries that write the year first. */
    private const array YEAR_FIRST = ['JP', 'CN', 'KR', 'SE', 'HU', 'LT', 'TW'];

    private const array DOT_COMMA = [
        'DE', 'ES', 'IT', 'NL', 'DK', 'ID', 'TR', 'GR', 'PT', 'BR', 'AR', 'CL', 'CO', 'RO', 'HR', 'SI', 'VN',
    ];

    private const array SPACE_COMMA = ['FR', 'SE', 'NO', 'FI', 'PL', 'CZ', 'SK', 'BG', 'RU', 'UA', 'HU', 'LT', 'LV', 'EE'];

    private const array APOSTROPHE = ['CH', 'LI'];

    public function __construct(public string $dateKey, public string $numberKey)
    {
        if (! isset(self::DATE_FORMATS[$dateKey]) || ! isset(self::NUMBER_FORMATS[$numberKey])) {
            throw new \InvalidArgumentException('Unknown date or number format.');
        }
    }

    /** The usual format in a country (ISO 3166 alpha-2). Unknown countries get the unambiguous day-month-name form and 1,234.56. */
    public static function forCountry(?string $country): self
    {
        $c = strtoupper((string) $country);

        return new self(
            match (true) {
                in_array($c, self::MONTH_FIRST, true) => 'mdy',
                in_array($c, self::YEAR_FIRST, true) => 'ymd',
                $c === '' => self::DEFAULT_DATE,
                // A country we know writes day first: the numeric form is clear there.
                in_array($c, ['GB', 'IE', 'AU', 'NZ', 'IN', 'KE', 'UG', 'TZ', 'ZA', 'NG', 'GH', 'DE', 'FR', 'ES', 'IT', 'NL', 'PT', 'BR', 'AE', 'SA', 'EG', 'SO', 'PK', 'BD'], true) => 'dmy',
                default => self::DEFAULT_DATE,
            },
            match (true) {
                in_array($c, self::DOT_COMMA, true) => 'dot_comma',
                in_array($c, self::SPACE_COMMA, true) => 'space_comma',
                in_array($c, self::APOSTROPHE, true) => 'apostrophe_dot',
                default => self::DEFAULT_NUMBER,
            },
        );
    }

    /** The company's choice, with the country's default filling what it did not choose. */
    public static function resolve(?string $dateKey, ?string $numberKey, ?string $country): self
    {
        $default = self::forCountry($country);

        return new self(
            $dateKey !== null && isset(self::DATE_FORMATS[$dateKey]) ? $dateKey : $default->dateKey,
            $numberKey !== null && isset(self::NUMBER_FORMATS[$numberKey]) ? $numberKey : $default->numberKey,
        );
    }

    /** A date as text. Accepts a date object or `YYYY-MM-DD` (a longer ISO timestamp is cut to its date); anything else is returned as it came. */
    public function date(DateTimeInterface|string|null $date): string
    {
        if ($date === null || $date === '') {
            return '';
        }
        if ($date instanceof DateTimeInterface) {
            return $date->format(self::DATE_FORMATS[$this->dateKey]['pattern']);
        }
        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/', $date, $m) !== 1 || ! checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            return $date;
        }

        return (new \DateTimeImmutable("{$m[1]}-{$m[2]}-{$m[3]}"))->format(self::DATE_FORMATS[$this->dateKey]['pattern']);
    }

    /** Integer minor units as grouped text with the currency's own number of decimals and a plain minus sign. */
    public function number(int $minor, int $decimals): string
    {
        $f = self::NUMBER_FORMATS[$this->numberKey];
        $sign = $minor < 0 ? '-' : '';
        $digits = (string) abs($minor);
        if ($decimals > 0) {
            $digits = str_pad($digits, $decimals + 1, '0', STR_PAD_LEFT);
            $whole = substr($digits, 0, -$decimals);
            $fraction = $f['decimal'].substr($digits, -$decimals);
        } else {
            $whole = $digits;
            $fraction = '';
        }

        return $sign.preg_replace('/\B(?=(\d{3})+(?!\d))/', $f['group'], $whole).$fraction;
    }

    /** Replaces every `YYYY-MM-DD` inside a sentence ("2026-01-01 to 2026-01-31") with the company's date text. */
    public function datesIn(string $text): string
    {
        return (string) preg_replace_callback('/\b(\d{4})-(\d{2})-(\d{2})\b/', fn (array $m) => $this->date($m[0]), $text);
    }
}
