<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

use App\Domain\Shared\Violation;
use Brick\Math\BigDecimal;

/**
 * The three-way match rule (13 §10). Pure, exact arithmetic.
 *
 * Price: the bill's unit price after discount may differ from the order's by at most the tolerance, either way.
 * Quantity: everything billed on an order line, this bill included, may exceed what was received by at most the
 * tolerance. Several bill lines on one order line count together, and the refusal names the first of them.
 */
final class ThreeWayMatch
{
    public const string PRICE = 'match_price_mismatch';

    public const string QUANTITY = 'match_quantity_exceeds_received';

    /**
     * @param  list<MatchLine>  $lines
     * @return list<Violation>
     */
    public static function check(array $lines, string $priceTolerancePct, string $quantityTolerancePct): array
    {
        $violations = [];
        /** @var array<string, array{line: MatchLine, quantity: string}> $byOrderLine */
        $byOrderLine = [];
        foreach ($lines as $line) {
            if (! self::priceWithin($line, $priceTolerancePct)) {
                $violations[] = new Violation(self::PRICE, "Line {$line->lineNo}: the price differs from {$line->orderLabel} by more than the tolerance.", $line->lineNo);
            }
            $seen = $byOrderLine[$line->orderLineId] ?? ['line' => $line, 'quantity' => '0'];
            $byOrderLine[$line->orderLineId] = ['line' => $seen['line'], 'quantity' => Quantity::add($seen['quantity'], $line->quantity)];
        }
        foreach ($byOrderLine as ['line' => $line, 'quantity' => $quantity]) {
            $billed = Quantity::add($quantity, $line->billedElsewhere);
            if (BigDecimal::of($billed)->isGreaterThan(Quantity::withTolerance($line->received, $quantityTolerancePct))) {
                $violations[] = new Violation(self::QUANTITY, "Line {$line->lineNo}: more is billed than was received on {$line->orderLabel}.", $line->lineNo);
            }
        }

        return $violations;
    }

    /** The bill's unit price after discount, exact (may carry decimals of a minor unit). */
    public static function netUnitPrice(int $unitPriceFc, string $discountPct): BigDecimal
    {
        return BigDecimal::of($unitPriceFc)->multipliedBy(BigDecimal::of('100')->minus($discountPct))->dividedByExact('100');
    }

    private static function priceWithin(MatchLine $line, string $tolerancePct): bool
    {
        $difference = self::netUnitPrice($line->unitPriceFc, $line->discountPct)->minus($line->orderPriceFc)->abs();
        $allowed = BigDecimal::of($line->orderPriceFc)->multipliedBy($tolerancePct)->dividedByExact('100');

        return ! $difference->isGreaterThan($allowed);
    }
}
