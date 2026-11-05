<?php

declare(strict_types=1);

namespace App\Domain\Budgets;

use App\Domain\Reports\ProfitLossSection;

/**
 * Budget against actual, both in the account's own direction (income and expense as positive figures, the way the profit and loss report
 * reads). Variance = actual − budget. Whether it is good depends on what the line is: more income than planned is favourable, more
 * expense than planned is adverse. A variance of zero is neither. The percentage is variance ÷ |budget|, to one decimal, rounded half up on
 * integers (`Variance::pct`), and absent when the budget is zero. Pure PHP.
 */
final class BudgetVariance
{
    /** Income sections are better when higher; cost sections when lower. */
    public static function higherIsBetter(ProfitLossSection $section): bool
    {
        return in_array($section, [ProfitLossSection::OperatingRevenue, ProfitLossSection::OtherIncome], true);
    }

    /** True for favourable, false for adverse, null when actual equals budget. */
    public static function favourable(int $budget, int $actual, bool $higherIsBetter): ?bool
    {
        $variance = $actual - $budget;
        if ($variance === 0) {
            return null;
        }

        return $higherIsBetter ? $variance > 0 : $variance < 0;
    }
}
