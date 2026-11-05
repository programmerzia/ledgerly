<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

use App\Domain\Shared\DomainRuleViolation;

/**
 * Monthly depreciation (D15.1), pure and exact in integer minor units. Every method works from the asset's carrying amount
 * now, so a change of estimate, an impairment or a revaluation simply applies from the next run (IAS 8, IAS 36.63, IAS 16.62):
 *
 *  - straight-line: (carrying - residual) / months left of the life, rounded HALF_UP; with one month left the charge is the whole
 *    remainder, so accumulated depreciation ends exactly at cost - residual. With nothing changed this is (cost - residual) / life
 *    each month, the last month absorbing the rounding;
 *  - declining balance: carrying x annual rate (basis points) / 12 / 10,000 rounded HALF_UP, never below the residual value; with
 *    a life set, the last month takes the remainder;
 *  - units of production: (carrying - residual) x units this run / units still expected; the run that uses the last expected
 *    units takes the remainder.
 *
 * A full month is charged for the month the asset becomes available for use (the first month due); an asset that is
 * disposed, not depreciable (land) or already at its residual value is never charged.
 */
final class DepreciationCalculator
{
    /**
     * The month ends still to be charged up to the month of $periodEnd. Empty when nothing is due.
     *
     * @return list<string>
     */
    public static function monthsDue(AssetState $s, string $periodEnd): array
    {
        if ($s->disposed || ! $s->depreciable || $s->carrying() <= $s->residual) {
            return [];
        }
        $first = $s->depreciatedThrough !== null ? Months::index($s->depreciatedThrough) + 1 : Months::index($s->availableFrom);
        $last = Months::index($periodEnd);
        $out = [];
        for ($i = $first; $i <= $last; $i++) {
            $out[] = Months::endOfIndex($i);
        }

        return $out;
    }

    /**
     * @param  list<string>  $months  from monthsDue()
     * @param  int|null  $units  units used in the run (units of production); null counts as none
     */
    public static function charge(AssetState $s, array $months, ?int $units = null): DepreciationCharge
    {
        if ($months === []) {
            return new DepreciationCharge([], 0, [], 0, $s->monthsCharged, $s->carrying(), $s->depreciatedThrough, 0, $s->counterfactualCarrying);
        }
        if ($s->method === DepreciationMethod::UnitsOfProduction) {
            return self::unitsOfProduction($s, $months, $units ?? 0);
        }

        $carrying = $s->carrying();
        $cf = $s->counterfactualCarrying;
        $monthsCharged = $s->monthsCharged;
        $schedule = [];
        $total = 0;
        $cfTotal = 0;
        foreach ($months as $monthEnd) {
            $amount = self::monthly($s, $carrying, $monthsCharged);
            $schedule[] = ['month_end' => $monthEnd, 'amount' => $amount];
            $carrying -= $amount;
            $total += $amount;
            if ($cf !== null) {
                $cfAmount = self::monthly($s, $cf, $monthsCharged);
                $cf -= $cfAmount;
                $cfTotal += $cfAmount;
            }
            $monthsCharged++;
        }

        return new DepreciationCharge($months, $total, $schedule, 0, $monthsCharged, $carrying, $months[count($months) - 1], $cfTotal, $cf);
    }

    /** One month's charge on a carrying amount, $monthsCharged months into the life. */
    private static function monthly(AssetState $s, int $carrying, int $monthsCharged): int
    {
        $base = $carrying - $s->residual;
        if ($base <= 0) {
            return 0;
        }
        $left = $s->lifeMonths === null ? null : $s->lifeMonths - $monthsCharged;
        if ($s->method === DepreciationMethod::DecliningBalance) {
            if ($left !== null && $left <= 1) {
                return $base;
            }

            return min($base, Round::mulDiv($carrying, $s->decliningRateBp ?? 0, 120000));
        }
        // Straight-line.
        if ($left === null) {
            return 0;
        }
        if ($left <= 1) {
            return $base;
        }

        return min($base, Round::mulDiv($base, 1, $left));
    }

    /** @param list<string> $months */
    private static function unitsOfProduction(AssetState $s, array $months, int $units): DepreciationCharge
    {
        $expected = ($s->unitsTotal ?? 0) - $s->unitsUsed;
        if ($units < 0 || $units > $expected) {
            throw DomainRuleViolation::single('units_exceed_remaining', "Units used ({$units}) cannot be more than the {$expected} still expected for this asset.");
        }
        $share = static function (int $carrying) use ($s, $units, $expected): int {
            $base = $carrying - $s->residual;
            if ($base <= 0 || $units === 0 || $expected <= 0) {
                return 0;
            }

            return $units === $expected ? $base : Round::mulDiv($base, $units, $expected);
        };
        $amount = $share($s->carrying());
        $cfAmount = $s->counterfactualCarrying === null ? 0 : $share($s->counterfactualCarrying);
        $last = $months[count($months) - 1];

        return new DepreciationCharge(
            $months, $amount, [['month_end' => $last, 'amount' => $amount]], $units, $s->monthsCharged + count($months),
            $s->carrying() - $amount, $last, $cfAmount, $s->counterfactualCarrying === null ? null : $s->counterfactualCarrying - $cfAmount,
        );
    }
}
