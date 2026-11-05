<?php

declare(strict_types=1);

namespace App\Domain\Budgets;

use InvalidArgumentException;

/**
 * Splitting an annual figure over periods, in integer minor units only (no floats). Each period gets the whole-unit share
 * `intdiv(total, parts)` (truncating toward zero) and the last period takes what is left, so the parts always add up to the total
 * exactly: 1,000.00 over 12 months is 83.33 for eleven months and 83.37 for the twelfth. Pure PHP.
 */
final class BudgetSpread
{
    /** @return list<int> */
    public static function even(int $total, int $parts): array
    {
        if ($parts < 1) {
            throw new InvalidArgumentException('Spread over at least one period.');
        }
        $each = intdiv($total, $parts);

        return [...array_fill(0, $parts - 1, $each), $total - $each * ($parts - 1)];
    }
}
