<?php

declare(strict_types=1);

namespace App\Domain\Reports;

/**
 * Maps an asset or liability account to the current / non-current presentation of IAS 1.60. Pure rules, no I/O.
 *
 * Order of precedence:
 *  1. deferred tax (IFRS element `DeferredTaxAssets` or `DeferredTaxLiabilities`) is always non-current,
 *     whatever the subtype says (IAS 1.56). Nothing below can override it, not even a tag;
 *  2. an explicit tag on the account's `reporting_tags`: `bs:current` or `bs:non_current` (the company's own
 *     answer, for example a provision it expects to settle in two years);
 *  3. held for sale (IFRS 5.3): an element naming "HeldForSale" is current, even though the element name starts
 *     with "Noncurrent";
 *  4. the IFRS Taxonomy element, where the chart set one: `Noncurrent…` and the decommissioning provision are
 *     non-current, `Current…` is current. This corrects the few accounts whose subtype covers both terms
 *     (a non-current lease liability under 'Borrowings');
 *  5. control type: fixed assets and accumulated depreciation or amortisation are non-current; receivables,
 *     payables, cash, bank, tax and suspense accounts are current;
 *  6. the subtype, from the tables below.
 *
 * `classify` returns null when nothing decides, so a test can prove that no subtype any chart ships is left
 * unmapped; the balance sheet then shows the account as current (the liquid side) and marks it `assumed`.
 * Equity has no current / non-current split.
 */
final class BalanceSheetClassifier
{
    private const array CURRENT_ASSET_SUBTYPES = [
        'Cash & Equivalents', 'Bank Account', 'Current Assets', 'Inventory', 'Prepayments', 'Tax Receivable', 'Reinsurance Assets',
    ];

    private const array NON_CURRENT_ASSET_SUBTYPES = [
        'Property, Plant & Equipment', 'Property and equipment', 'Non-current Assets', 'Intangible Assets', 'Investments',
    ];

    /** 'Contra Asset' is decided by the control type: accumulated depreciation is non-current, an allowance on receivables is current. */
    private const string CONTRA_ASSET = 'Contra Asset';

    private const array CURRENT_LIABILITY_SUBTYPES = [
        'Current Liabilities', 'Tax Payable', 'Deferred Income', 'Payroll Liabilities', 'Clearing', 'Insurance Reserves', 'Provisions', 'Borrowings',
    ];

    private const array NON_CURRENT_LIABILITY_SUBTYPES = ['Non-current Liabilities'];

    private const array NON_CURRENT_ELEMENTS = ['DeferredTaxAssets', 'DeferredTaxLiabilities', 'ProvisionForDecommissioningRestorationAndRehabilitationCosts'];

    /** @return list<string> every subtype the tables know, for the test that walks the charts */
    public static function knownSubtypes(string $accountType): array
    {
        return match ($accountType) {
            'asset' => [...self::CURRENT_ASSET_SUBTYPES, ...self::NON_CURRENT_ASSET_SUBTYPES, self::CONTRA_ASSET],
            'liability' => [...self::CURRENT_LIABILITY_SUBTYPES, ...self::NON_CURRENT_LIABILITY_SUBTYPES],
            default => [],
        };
    }

    public static function isDeferredTax(?string $ifrsElement): bool
    {
        return in_array($ifrsElement, ['DeferredTaxAssets', 'DeferredTaxLiabilities'], true);
    }

    /**
     * Class by subtype and control type alone (no element, no tag); null when the subtype is unknown.
     */
    public static function bySubtype(string $accountType, ?string $subtype, string $controlType): ?BalanceSheetClass
    {
        $byControl = match ($controlType) {
            'fixed_asset', 'accum_depr' => BalanceSheetClass::NonCurrent,
            'ar', 'ap', 'cash', 'bank', 'tax', 'suspense' => BalanceSheetClass::Current,
            default => null,
        };
        if ($byControl !== null) {
            return $byControl;
        }
        if ($accountType === 'asset') {
            return match (true) {
                in_array($subtype, self::CURRENT_ASSET_SUBTYPES, true), $subtype === self::CONTRA_ASSET => BalanceSheetClass::Current,
                in_array($subtype, self::NON_CURRENT_ASSET_SUBTYPES, true) => BalanceSheetClass::NonCurrent,
                default => null,
            };
        }

        return match (true) {
            in_array($subtype, self::CURRENT_LIABILITY_SUBTYPES, true) => BalanceSheetClass::Current,
            in_array($subtype, self::NON_CURRENT_LIABILITY_SUBTYPES, true) => BalanceSheetClass::NonCurrent,
            default => null,
        };
    }

    /**
     * @param  list<string>  $tags
     */
    public static function classify(string $accountType, ?string $subtype, string $controlType, array $tags = [], ?string $ifrsElement = null): ?BalanceSheetClass
    {
        if (! in_array($accountType, ['asset', 'liability'], true)) {
            return null;
        }
        if (self::isDeferredTax($ifrsElement)) {
            return BalanceSheetClass::NonCurrent;
        }
        foreach (BalanceSheetClass::cases() as $class) {
            if (in_array('bs:'.$class->value, $tags, true)) {
                return $class;
            }
        }
        if ($ifrsElement !== null) {
            if (str_contains($ifrsElement, 'HeldForSale')) {
                return BalanceSheetClass::Current;
            }
            if (str_starts_with($ifrsElement, 'Noncurrent') || in_array($ifrsElement, self::NON_CURRENT_ELEMENTS, true)) {
                return BalanceSheetClass::NonCurrent;
            }
            if (str_starts_with($ifrsElement, 'Current')) {
                return BalanceSheetClass::Current;
            }
        }

        return self::bySubtype($accountType, $subtype, $controlType);
    }
}
