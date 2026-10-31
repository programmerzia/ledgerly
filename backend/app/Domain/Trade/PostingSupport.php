<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Shared\Fx;

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

        return new ProposedLine($roundingAccount, $diff < 0 ? abs($diff) : 0, $diff > 0 ? $diff : 0, $currency, $fxRate, 0, $dimensions, $description);
    }
}
