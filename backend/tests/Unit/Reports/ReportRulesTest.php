<?php

declare(strict_types=1);

use App\Domain\Reports\CashFlowActivity;
use App\Domain\Reports\CashFlowClassifier;
use App\Domain\Reports\ProfitLossSection;
use App\Queries\Reports\Variance;
use App\Support\Reports\Dates;
use App\Support\Reports\Export\Amounts;

it('puts income and expense accounts into the sections named by their subtype', function (): void {
    expect(ProfitLossSection::of('income', 'Operating Revenue'))->toBe(ProfitLossSection::OperatingRevenue)
        ->and(ProfitLossSection::of('income', 'Other Income'))->toBe(ProfitLossSection::OtherIncome)
        ->and(ProfitLossSection::of('income', 'Investment income'))->toBe(ProfitLossSection::OperatingRevenue)
        ->and(ProfitLossSection::of('expense', 'Direct Costs'))->toBe(ProfitLossSection::DirectCosts)
        ->and(ProfitLossSection::of('expense', 'Operating Expense'))->toBe(ProfitLossSection::OperatingExpense)
        ->and(ProfitLossSection::of('expense', 'Other Expense'))->toBe(ProfitLossSection::OtherExpense)
        ->and(ProfitLossSection::of('expense', null))->toBe(ProfitLossSection::OperatingExpense)
        ->and(ProfitLossSection::of('asset', 'Current Assets'))->toBeNull();
});

it('classifies balance sheet accounts for the cash flow, tags first, IAS 7 default last', function (): void {
    $c = fn (string $type, ?string $subtype, string $control = 'none', array $tags = []) => CashFlowClassifier::classify($type, $subtype, $control, $tags);

    expect($c('asset', 'Property, Plant & Equipment', 'fixed_asset')->activity)->toBe(CashFlowActivity::Investing)
        ->and($c('asset', 'Contra Asset', 'accum_depr')->nonCash)->toBeTrue()
        ->and($c('asset', 'Contra Asset', 'accum_depr')->activity)->toBe(CashFlowActivity::Operating)
        ->and($c('asset', 'Contra Asset')->activity)->toBe(CashFlowActivity::Operating)        // allowance for doubtful accounts
        ->and($c('asset', 'Investments')->activity)->toBe(CashFlowActivity::Investing)
        ->and($c('asset', 'Current Assets', 'ar')->activity)->toBe(CashFlowActivity::Operating)
        ->and($c('liability', 'Current Liabilities', 'ap')->activity)->toBe(CashFlowActivity::Operating)
        ->and($c('liability', 'Tax Payable', 'tax')->activity)->toBe(CashFlowActivity::Operating)
        ->and($c('liability', 'Non-current Liabilities')->activity)->toBe(CashFlowActivity::Financing)
        ->and($c('equity', 'Contributed Capital')->activity)->toBe(CashFlowActivity::Financing)
        ->and($c('equity', 'Retained Earnings', 'retained_earnings')->activity)->toBe(CashFlowActivity::Financing)
        ->and($c('equity', 'Fund Balances')->activity)->toBe(CashFlowActivity::Financing);

    // A tag is the company's own answer and beats the subtype.
    $provision = $c('liability', 'Non-current Liabilities', 'none', ['cf:operating']);
    expect($provision->activity)->toBe(CashFlowActivity::Operating)->and($provision->assumed)->toBeFalse();

    // Nothing decides it: operating by IAS 7.6, and flagged so the report can list it.
    $odd = $c('asset', 'Something Custom');
    expect($odd->activity)->toBe(CashFlowActivity::Operating)->and($odd->assumed)->toBeTrue()
        ->and($c('liability', null)->assumed)->toBeTrue();
});

it('computes variance percentages in integers, HALF_UP, with the sign of the change', function (): void {
    expect(Variance::pct(500, 4_000))->toBe('12.5')
        ->and(Variance::pct(-500, 4_000))->toBe('-12.5')
        ->and(Variance::pct(100, -4_000))->toBe('2.5')
        ->and(Variance::pct(1, 3))->toBe('33.3')
        ->and(Variance::pct(1, 8))->toBe('12.5')
        ->and(Variance::pct(1, 1_600))->toBe('0.1')       // 0.0625 % rounds half up to 0.1
        ->and(Variance::pct(1, 1_000_000))->toBe('0.0')
        ->and(Variance::pct(5, 0))->toBeNull();
});

it('does calendar arithmetic on date strings', function (): void {
    expect(Dates::yearBefore('2026-02-28'))->toBe('2025-02-28')
        ->and(Dates::yearBefore('2024-02-29'))->toBe('2023-02-28')
        ->and(Dates::yearBefore('2025-02-28'))->toBe('2024-02-29')   // last day of month maps to last day of month
        ->and(Dates::yearBefore('2026-03-15'))->toBe('2025-03-15')
        ->and(Dates::before('2026-03-01'))->toBe('2026-02-28')
        ->and(Dates::after('2026-12-31'))->toBe('2027-01-01')
        ->and(Dates::days('2026-01-01', '2026-01-31'))->toBe(30);
});

it('formats minor units exactly and escapes spreadsheet formulas', function (): void {
    expect(Amounts::text(157_500, 2))->toBe('1575.00')->and(Amounts::text(-5, 2))->toBe('-0.05')->and(Amounts::text(7, 0))->toBe('7')
        ->and(Amounts::text(1_234, 3))->toBe('1.234')->and(Amounts::text(PHP_INT_MAX, 2))->toBe('92233720368547758.07')
        ->and(Amounts::safe('=SUM(A1)'))->toBe("'=SUM(A1)")->and(Amounts::safe('+1'))->toBe("'+1")->and(Amounts::safe('@x'))->toBe("'@x")
        ->and(Amounts::safe('-cmd'))->toBe("'-cmd")->and(Amounts::safe("\tx"))->toBe("'\tx")->and(Amounts::safe('Cash'))->toBe('Cash')->and(Amounts::safe(''))->toBe('');
});

it('classifies short-term borrowings as financing and provisions as operating (IAS 7)', function (): void {
    expect(CashFlowClassifier::classify('liability', 'Borrowings', 'none')->activity)->toBe(CashFlowActivity::Financing)
        ->and(CashFlowClassifier::classify('liability', 'Provisions', 'none')->activity)->toBe(CashFlowActivity::Operating);
});
