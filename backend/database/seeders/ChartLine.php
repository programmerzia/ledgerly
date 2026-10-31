<?php

declare(strict_types=1);

namespace Database\Seeders;

/**
 * Builds one line of a chart template (database/seeders/charts/*.php). ApplyChartTemplate copies a
 * line into one `accounts` row, so the keys map onto the columns of that table:
 *
 *  - `parent_code` names another line of the same template. A line that is some other line's parent is
 *    a group header and is created non-postable; every other line is postable.
 *  - `normal_balance` defaults to the usual side of the type (asset and expense: debit; liability,
 *    equity and income: credit). Pass it for contra accounts such as accumulated depreciation.
 *  - `currency_policy` is `base_only` or `any`. `fixed` is not available because a template cannot know
 *    the currency. Use `any` where a customer invoice, supplier bill or bank statement line can carry a
 *    foreign currency, and `base_only` where only journals in the company currency post.
 *  - `account_subtype` is never empty (the SPA types it as a string). The report sections key on the
 *    income subtypes 'Operating Revenue' and 'Other Income' and the expense subtypes 'Direct Costs',
 *    'Operating Expense' and 'Other Expense'.
 */
final class ChartLine
{
    /**
     * @param  'asset'|'liability'|'equity'|'income'|'expense'  $type
     * @param  'none'|'ar'|'ap'|'bank'|'cash'|'tax'|'retained_earnings'|'suspense'|'fixed_asset'|'accum_depr'  $control
     * @param  'base_only'|'any'  $currency
     * @param  'debit'|'credit'|null  $normal  null = the usual side of $type
     * @return array{code: string, name: string, account_type: string, account_subtype: string, normal_balance: string, control_type: string, currency_policy: string, parent_code: string|null, description: string|null}
     */
    public static function make(
        string $code,
        string $name,
        string $type,
        string $subtype,
        ?string $parent = null,
        string $control = 'none',
        string $currency = 'base_only',
        ?string $normal = null,
        ?string $description = null,
    ): array {
        return [
            'code' => $code,
            'name' => $name,
            'account_type' => $type,
            'account_subtype' => $subtype,
            'normal_balance' => $normal ?? (in_array($type, ['asset', 'expense'], true) ? 'debit' : 'credit'),
            'control_type' => $control,
            'currency_policy' => $currency,
            'parent_code' => $parent,
            'description' => $description,
        ];
    }
}
