<?php

declare(strict_types=1);

namespace App\Domain\Tax;

use App\Domain\Shared\DomainRuleViolation;
use Brick\Math\BigRational;
use Brick\Math\RoundingMode;

/**
 * Document tax (23 D2), exact: rates and line taxes are rationals (brick/math), amounts are integer minor
 * units, nothing is a float.
 *
 * `document_per_code` (default): each line's tax per code is computed unrounded; the lines' taxes are summed
 * per code; each sum is rounded once, HALF_UP (ties away from zero); the rounded sum is allocated back to the
 * lines by largest remainder (ties go to the earlier line), so line tax adds up to the document tax per code.
 * `line`: each line's tax per code is rounded HALF_UP on its own.
 *
 * Exclusive pricing: tax is charged on the net. Inclusive pricing: the line amount is the gross, and the
 * net is what is left after the tax inside it (net = gross / (1 + combined factor)). In a tax group the
 * components apply in sequence, and a compound component is charged on the net plus the taxes before it.
 * Pure: no framework, no clock.
 */
final class TaxCalculator
{
    /** @param  list<TaxLine>  $lines */
    public static function calculate(array $lines, TaxRounding $rounding = TaxRounding::DocumentPerCode): TaxResult
    {
        // line index → tax code id → unrounded tax
        $exact = [];
        /** @var array<string, list<int>> $linesOfCode */
        $linesOfCode = [];
        foreach ($lines as $i => $line) {
            $exact[$i] = self::exactTaxes($line);
            foreach (array_keys($exact[$i]) as $code) {
                $linesOfCode[$code][] = $i;
            }
        }

        // line index → code → rounded tax
        $rounded = array_fill(0, count($lines), []);
        foreach ($linesOfCode as $code => $indices) {
            if ($rounding === TaxRounding::Line) {
                foreach ($indices as $i) {
                    $rounded[$i][$code] = self::round($exact[$i][$code]);
                }
            } else {
                foreach (self::allocate(array_map(fn (int $i): BigRational => $exact[$i][$code], $indices)) as $k => $share) {
                    $rounded[$indices[$k]][$code] = $share;
                }
            }
        }

        $out = [];
        $byCode = [];
        $net = $tax = 0;
        foreach ($lines as $i => $line) {
            $lineTax = array_sum($rounded[$i]);
            $lineNet = $line->inclusive ? $line->amount - $lineTax : $line->amount;
            $out[] = new LineTax($lineNet, $lineTax, $lineNet + $lineTax, $rounded[$i]);
            foreach ($rounded[$i] as $code => $amount) {
                $byCode[$code] = ($byCode[$code] ?? 0) + $amount;
            }
            $net += $lineNet;
            $tax += $lineTax;
        }

        return new TaxResult($out, $byCode, $net, $tax, $net + $tax);
    }

    /**
     * One line's unrounded tax per code. A code that appears twice on a line adds up.
     *
     * @return array<string, BigRational>
     */
    private static function exactTaxes(TaxLine $line): array
    {
        if ($line->components === []) {
            return [];
        }

        // Each component's tax as a multiple of the net: f_i = r_i, or r_i × (1 + f_1 + … + f_{i-1}) when compound.
        $factors = [];
        $before = BigRational::zero();
        foreach ($line->components as $c) {
            $factor = $c->compound ? $c->rate->multipliedBy(BigRational::one()->plus($before)) : $c->rate;
            $factors[] = $factor;
            $before = $before->plus($factor);
        }
        $amount = BigRational::of($line->amount);
        // Inclusive: gross = net × (1 + F), so net = gross / (1 + F).
        $net = $line->inclusive ? $amount->dividedBy(BigRational::one()->plus($before)) : $amount;

        $taxes = [];
        foreach ($line->components as $k => $c) {
            $taxes[$c->taxCodeId] = ($taxes[$c->taxCodeId] ?? BigRational::zero())->plus($net->multipliedBy($factors[$k]));
        }

        return $taxes;
    }

    /**
     * Round the sum once and hand the rounded sum back to the items: floor each, then give the missing units to
     * the largest fractional remainders (earlier item first on ties).
     *
     * @param  list<BigRational>  $exact
     * @return list<int>
     */
    private static function allocate(array $exact): array
    {
        $total = BigRational::zero();
        $floors = [];
        $remainders = [];
        foreach ($exact as $k => $value) {
            $total = $total->plus($value);
            $floors[$k] = $value->toScale(0, RoundingMode::Floor)->toInt();
            $remainders[$k] = $value->minus($floors[$k]);
        }
        $leftover = self::round($total) - array_sum($floors);
        if ($leftover < 0 || $leftover > count($exact)) {
            throw DomainRuleViolation::single('tax_allocation_failed', 'Tax could not be allocated to the lines.');
        }

        $order = array_keys($exact);
        usort($order, fn (int $a, int $b): int => $remainders[$b]->compareTo($remainders[$a]) ?: $a <=> $b);
        foreach (array_slice($order, 0, $leftover) as $k) {
            $floors[$k]++;
        }

        return array_values($floors);
    }

    /** HALF_UP to a whole minor unit: ties go away from zero. */
    private static function round(BigRational $value): int
    {
        return $value->toScale(0, RoundingMode::HalfUp)->toInt();
    }
}
