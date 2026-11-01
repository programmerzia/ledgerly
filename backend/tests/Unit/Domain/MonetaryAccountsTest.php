<?php

declare(strict_types=1);

use App\Domain\Fx\MonetaryAccounts;
use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;

// IAS 21.16: only items settled in a fixed number of currency units are revalued.
it('classifies accounts for revaluation', function (string $type, ControlType $control, CurrencyPolicy $policy, ?string $subtype, bool $revalued): void {
    expect(MonetaryAccounts::isRevalued($type, $control, $policy, $subtype))->toBe($revalued);
})->with([
    'receivables' => ['asset', ControlType::Ar, CurrencyPolicy::Any, 'Current Assets', true],
    'payables' => ['liability', ControlType::Ap, CurrencyPolicy::Any, 'Current Liabilities', true],
    'foreign bank' => ['asset', ControlType::Bank, CurrencyPolicy::Fixed, 'Bank Account', true],
    'other receivable' => ['asset', ControlType::None, CurrencyPolicy::Any, 'Current Assets', true],
    'prepayments' => ['asset', ControlType::None, CurrencyPolicy::Any, 'Prepayments', false],
    'deferred income' => ['liability', ControlType::None, CurrencyPolicy::Any, 'Deferred Income', false],
    'inventory' => ['asset', ControlType::None, CurrencyPolicy::Any, 'Inventory', false],
    'fixed assets' => ['asset', ControlType::FixedAsset, CurrencyPolicy::Any, 'Property, Plant & Equipment', false],
    'base only' => ['asset', ControlType::None, CurrencyPolicy::BaseOnly, 'Current Assets', false],
    'income' => ['income', ControlType::None, CurrencyPolicy::Any, 'Operating Revenue', false],
]);
