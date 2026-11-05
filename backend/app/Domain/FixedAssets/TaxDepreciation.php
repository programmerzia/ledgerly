<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

/**
 * Tax depreciation of one item (plan 3c.15b), pure and country-neutral: straight-line on cost, never a declining-balance pool.
 * The first year takes the first-year rate when the class has one, otherwise the annual rate; every later year takes the annual
 * rate on cost, in equal instalments, until the cost is written off, the last instalment being whatever is left. Each year's
 * allowance is rounded HALF_UP to a minor unit. It reads no ledger and posts nothing.
 */
final class TaxDepreciation
{
    /**
     * @return list<array{year_index: int, allowance: int, written_down: int}> year_index 0 is the year of first use
     */
    public static function schedule(int $cost, int $annualRateBp, ?int $firstYearRateBp, int $maxYears = 1000): array
    {
        $out = [];
        $remaining = $cost;
        for ($i = 0; $remaining > 0 && $i < $maxYears; $i++) {
            $rate = $i === 0 ? ($firstYearRateBp ?? $annualRateBp) : $annualRateBp;
            $allowance = min($remaining, Round::mulDiv($cost, $rate, 10000));
            if ($allowance <= 0) {
                break;     // a rate too small to reach a minor unit would never finish
            }
            $remaining -= $allowance;
            $out[] = ['year_index' => $i, 'allowance' => $allowance, 'written_down' => $remaining];
        }

        return $out;
    }
}
