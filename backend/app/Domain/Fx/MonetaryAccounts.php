<?php

declare(strict_types=1);

namespace App\Domain\Fx;

use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;

/**
 * Which balance-sheet accounts IAS 21.23 revalues at the closing rate: monetary items only (cash, bank,
 * receivables, payables, tax balances, loans). Non-monetary items (PPE and depreciation, inventory, intangibles,
 * investments, prepayments, deferred income, equity, income and expense) stay at their historical rate. An account takes part only when its
 * currency policy lets it hold foreign currency at all; turning that off (base_only) is how a company
 * opts any other account out.
 */
final class MonetaryAccounts
{
    /** Subtypes of the chart templates that hold non-monetary items (IAS 21.16). */
    private const array NON_MONETARY_SUBTYPES = [
        'Inventory', 'Property, Plant & Equipment', 'Intangible Assets', 'Non-current Assets', 'Investments',
        // IAS 21.16: prepayments for goods and services and deferred income settle in kind, not in cash.
        'Prepayments', 'Deferred Income',
    ];

    public static function isRevalued(string $accountType, ControlType $control, CurrencyPolicy $policy, ?string $subtype): bool
    {
        if (! in_array($accountType, ['asset', 'liability'], true) || $policy === CurrencyPolicy::BaseOnly) {
            return false;
        }
        if (in_array($control, [ControlType::FixedAsset, ControlType::AccumDepr, ControlType::RetainedEarnings], true)) {
            return false;
        }

        return $control !== ControlType::None || ! in_array($subtype, self::NON_MONETARY_SUBTYPES, true);
    }
}
