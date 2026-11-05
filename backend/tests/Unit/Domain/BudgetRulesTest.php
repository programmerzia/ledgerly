<?php

declare(strict_types=1);

use App\Domain\Budgets\BudgetSpread;
use App\Domain\Budgets\BudgetVariance;
use App\Domain\Organisation\NumberingKinds;
use App\Domain\Reports\ProfitLossSection;
use App\Queries\Reports\Variance;

it('spreads a total over periods with the remainder in the last, always adding up exactly', function (): void {
    expect(BudgetSpread::even(100000, 12))->toBe([...array_fill(0, 11, 8333), 8337])
        ->and(BudgetSpread::even(12, 12))->toBe(array_fill(0, 12, 1))
        ->and(BudgetSpread::even(5, 12))->toBe([...array_fill(0, 11, 0), 5])
        ->and(BudgetSpread::even(-100000, 12))->toBe([...array_fill(0, 11, -8333), -8337])
        ->and(BudgetSpread::even(7, 1))->toBe([7])
        ->and(BudgetSpread::even(0, 12))->toBe(array_fill(0, 12, 0));
    foreach ([1, 7, 99, 100001, 999_999_999_999_999, -123_456_789] as $total) {
        foreach ([1, 3, 12, 13] as $parts) {
            expect(array_sum(BudgetSpread::even($total, $parts)))->toBe($total);
        }
    }
    expect(fn () => BudgetSpread::even(1, 0))->toThrow(InvalidArgumentException::class);
});

it('judges favourable by what the line is, and treats a zero variance as neither', function (): void {
    $up = BudgetVariance::higherIsBetter(ProfitLossSection::OperatingRevenue);
    $down = BudgetVariance::higherIsBetter(ProfitLossSection::OperatingExpense);
    expect($up)->toBeTrue()->and($down)->toBeFalse()
        ->and(BudgetVariance::higherIsBetter(ProfitLossSection::OtherIncome))->toBeTrue()
        ->and(BudgetVariance::higherIsBetter(ProfitLossSection::DirectCosts))->toBeFalse()
        ->and(BudgetVariance::favourable(100, 120, $up))->toBeTrue()->and(BudgetVariance::favourable(100, 80, $up))->toBeFalse()
        ->and(BudgetVariance::favourable(100, 120, $down))->toBeFalse()->and(BudgetVariance::favourable(100, 80, $down))->toBeTrue()
        ->and(BudgetVariance::favourable(100, 100, $up))->toBeNull()
        // Spending with no budget at all is adverse, not neutral.
        ->and(BudgetVariance::favourable(0, 50, $down))->toBeFalse();
});

it('rounds the variance percentage to one decimal, half up, on integers', function (): void {
    expect(Variance::pct(20000, 80000))->toBe('25.0')->and(Variance::pct(10000, 140000))->toBe('7.1')
        ->and(Variance::pct(-30000, 40000))->toBe('-75.0')->and(Variance::pct(1, 8))->toBe('12.5')->and(Variance::pct(1, 16))->toBe('6.3')
        ->and(Variance::pct(5, 0))->toBeNull()->and(Variance::pct(-1, 3000))->toBe('0.0');
});

it('accepts capital-letter-and-digit prefixes only, and builds the example number', function (): void {
    foreach (['INV', 'SI2', 'A', 'ABCDEFGH'] as $ok) {
        expect(NumberingKinds::prefixProblems($ok))->toBe([]);
    }
    foreach (['', 'inv', 'IN-V', '1A', 'A B', 'ABCDEFGHI', 'É'] as $bad) {
        expect(NumberingKinds::prefixProblems($bad))->not->toBe([]);
    }
    expect(NumberingKinds::example('SI', 6, 'FY2027'))->toBe('SI-FY2027-000001')
        ->and(NumberingKinds::parseKey('doc:sales_invoice:FY2026'))->toBe(['sales_invoice', 'FY2026'])
        ->and(NumberingKinds::parseKey('journal:FY2026'))->toBe(['journal', 'FY2026'])
        ->and(NumberingKinds::parseKey('doc:unknown_thing:FY2026'))->toBeNull()
        ->and(NumberingKinds::sequenceKey('journal', 'FY2026'))->toBe('journal:FY2026');
});
