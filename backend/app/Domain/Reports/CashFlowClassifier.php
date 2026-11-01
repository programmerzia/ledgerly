<?php

declare(strict_types=1);

namespace App\Domain\Reports;

/**
 * Maps a balance sheet account to a cash flow activity. Pure rules, no I/O.
 *
 * Order of precedence:
 *  1. an explicit tag on the account's `reporting_tags`: `cf:operating`, `cf:investing` or `cf:financing`
 *     (the company's own answer, for example a provision in the 'Non-current Liabilities' subtype);
 *  2. control type: accumulated depreciation is a non-cash add-back to operating; fixed assets are investing;
 *     retained earnings (dividends and other distributions, with year-end closing already left out) are financing;
 *     receivables, payables and tax accounts are operating;
 *  3. account subtype: property, intangibles, investments and 'Non-current Assets' are investing;
 *     'Non-current Liabilities' and equity (contributed capital, fund balances, reserves) are financing;
 *     every other current asset and liability is working capital, so operating;
 *  4. anything else: IAS 7.6 defines operating activities as the entity's principal revenue-producing
 *     activities and every activity that is not investing or financing, so the account is operating and
 *     flagged `assumed` for the report to list.
 *
 * Interest and income tax paid stay in operating through net profit (IAS 7.33, 7.35), and dividends paid
 * are financing (IAS 7.34), which is the policy choice IAS 7 allows.
 */
final class CashFlowClassifier
{
    private const array INVESTING_SUBTYPES = [
        'Property, Plant & Equipment', 'Property and equipment', 'Non-current Assets', 'Intangible Assets', 'Investments',
    ];

    private const array FINANCING_SUBTYPES = ['Non-current Liabilities', 'Borrowings'];

    private const array OPERATING_ASSET_SUBTYPES = [
        'Current Assets', 'Inventory', 'Prepayments', 'Tax Receivable', 'Contra Asset', 'Reinsurance Assets',
    ];

    private const array OPERATING_LIABILITY_SUBTYPES = [
        'Current Liabilities', 'Tax Payable', 'Deferred Income', 'Payroll Liabilities', 'Clearing', 'Insurance Reserves', 'Provisions',
    ];

    /**
     * @param  list<string>  $tags
     */
    public static function classify(string $accountType, ?string $subtype, string $controlType, array $tags = []): CashFlowClass
    {
        foreach (CashFlowActivity::cases() as $activity) {
            if (in_array('cf:'.$activity->value, $tags, true)) {
                return new CashFlowClass($activity, false, false, "Tagged cf:{$activity->value} on the account.");
            }
        }

        $control = match ($controlType) {
            'accum_depr' => new CashFlowClass(CashFlowActivity::Operating, true, false, 'Depreciation is charged to profit but paid in no cash.'),
            'fixed_asset' => new CashFlowClass(CashFlowActivity::Investing, false, false, 'Fixed assets: purchases and disposals are investing.'),
            'retained_earnings' => new CashFlowClass(CashFlowActivity::Financing, false, false, 'Distributions to owners are financing; the year-end close is left out.'),
            'ar', 'ap', 'tax' => new CashFlowClass(CashFlowActivity::Operating, false, false, 'Trade and tax balances are working capital.'),
            default => null,
        };
        if ($control !== null) {
            return $control;
        }

        if ($accountType === 'equity') {
            return new CashFlowClass(CashFlowActivity::Financing, false, false, 'Contributed capital, funds and reserves are financing.');
        }
        if ($accountType === 'asset') {
            if (in_array($subtype, self::INVESTING_SUBTYPES, true)) {
                return new CashFlowClass(CashFlowActivity::Investing, false, false, "Subtype {$subtype} is a long-term asset.");
            }
            if (in_array($subtype, self::OPERATING_ASSET_SUBTYPES, true)) {
                return new CashFlowClass(CashFlowActivity::Operating, false, false, "Subtype {$subtype} is working capital.");
            }
        }
        if ($accountType === 'liability') {
            if (in_array($subtype, self::FINANCING_SUBTYPES, true)) {
                return new CashFlowClass(CashFlowActivity::Financing, false, false, "Subtype {$subtype} holds borrowings.");
            }
            if (in_array($subtype, self::OPERATING_LIABILITY_SUBTYPES, true)) {
                return new CashFlowClass(CashFlowActivity::Operating, false, false, "Subtype {$subtype} is working capital.");
            }
        }

        return new CashFlowClass(CashFlowActivity::Operating, false, true, 'Not classified by the mapping; IAS 7.6 puts activities that are neither investing nor financing in operating.');
    }
}
