<?php

declare(strict_types=1);

namespace App\Domain\Reports;

/**
 * Which profit and loss section an income or expense account belongs to, by `account_subtype` (the starter
 * charts use 'Operating Revenue', 'Other Income', 'Direct Costs', 'Operating Expense', 'Other Expense').
 * Income that is not 'Other Income' is operating revenue; expenses that are neither 'Direct Costs' nor
 * 'Other Expense' are operating expenses, so an account with a subtype the charts do not know still lands
 * in a section instead of vanishing from the total.
 */
enum ProfitLossSection: string
{
    case OperatingRevenue = 'operating_revenue';
    case DirectCosts = 'direct_costs';
    case OperatingExpense = 'operating_expense';
    case OtherIncome = 'other_income';
    case OtherExpense = 'other_expense';

    public static function of(string $accountType, ?string $subtype): ?self
    {
        return match ($accountType) {
            'income' => $subtype === 'Other Income' ? self::OtherIncome : self::OperatingRevenue,
            'expense' => match ($subtype) {
                'Direct Costs' => self::DirectCosts,
                'Other Expense' => self::OtherExpense,
                default => self::OperatingExpense,
            },
            default => null,
        };
    }

    public function title(): string
    {
        return match ($this) {
            self::OperatingRevenue => 'Revenue',
            self::DirectCosts => 'Cost of sales',
            self::OperatingExpense => 'Operating expenses',
            self::OtherIncome => 'Other income',
            self::OtherExpense => 'Other expenses',
        };
    }
}
