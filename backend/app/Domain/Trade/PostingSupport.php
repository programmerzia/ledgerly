<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Fx;
use Brick\Math\BigDecimal;

/** Helpers shared by the trade rules; mirrors the mock's JS semantics where they matter for parity. */
final class PostingSupport
{
    /** Foreign minor units to base minor units, one HALF_UP rounding (D1). Same-scale currencies only. */
    public static function toBase(int $amountFc, string $rate): int
    {
        return Fx::toBase($amountFc, $rate, 2, 2);
    }

    /** JS `value || default`: null and the empty string fall back. */
    public static function orDefault(?string $value, string $default): string
    {
        return $value === null || $value === '' ? $default : $value;
    }

    /**
     * Tax in document currency (D10). A base-currency document may only state the base total; on a
     * foreign-currency document the base amount must never be read as foreign currency.
     */
    public static function documentTaxFc(int $taxTotalFc, int $taxTotal, string $rate): int
    {
        if ($taxTotalFc !== 0 || $taxTotal === 0) {
            return $taxTotalFc;
        }
        if (BigDecimal::of($rate)->isEqualTo(1)) {
            return $taxTotal;
        }

        throw DomainRuleViolation::single('tax_total_fc_missing', 'A foreign-currency document must state its tax in the document currency.');
    }

    /**
     * @param  list<ProposedLine>  $lines
     * @return array{0: int, 1: int}
     */
    public static function totals(array $lines): array
    {
        return [
            array_sum(array_map(static fn (ProposedLine $l): int => $l->debit, $lines)),
            array_sum(array_map(static fn (ProposedLine $l): int => $l->credit, $lines)),
        ];
    }

    /**
     * Residue line that forces the journal to balance, or null when it already does.
     *
     * @param  list<ProposedLine>  $lines
     * @param  array<string, string>  $dimensions
     */
    public static function residue(array $lines, string $roundingAccount, string $currency, string $fxRate, array $dimensions, string $description): ?ProposedLine
    {
        [$debits, $credits] = self::totals($lines);
        $diff = $debits - $credits;
        if ($diff === 0) {
            return null;
        }
        // D1: rounding absorbs conversion residue only, at most half a minor unit per line.
        if (abs($diff) * 2 > count($lines)) {
            throw DomainRuleViolation::single('rounding_residue_too_large', 'The difference is larger than currency rounding can explain.');
        }

        return new ProposedLine($roundingAccount, $diff < 0 ? abs($diff) : 0, $diff > 0 ? $diff : 0, $currency, $fxRate, 0, $dimensions, $description);
    }
}
