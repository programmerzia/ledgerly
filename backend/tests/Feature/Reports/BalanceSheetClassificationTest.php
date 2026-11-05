<?php

declare(strict_types=1);

use App\Domain\Reports\BalanceSheetClass;
use App\Domain\Reports\BalanceSheetClassifier;
use App\Domain\Reports\CashFlowActivity;
use App\Domain\Reports\CashFlowClassifier;
use App\Queries\Reports\RunReport;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\ReportScenario;

/*
 * 3c.17a: IAS 1.60 current / non-current presentation. Every asset and liability subtype any shipped chart uses
 * must map to a class (a new subtype fails here until it is mapped), and deferred tax is non-current whatever the
 * subtype says (IAS 1.56).
 */

/** @return list<array<string, mixed>> the lines of every chart file under database/seeders/charts */
function shippedChartLines(): array
{
    $out = [];
    foreach (glob(database_path('seeders/charts/*.php')) ?: [] as $file) {
        $chart = require $file;
        foreach ($chart['lines'] as $line) {
            $out[] = $line + ['chart' => $chart['code']];
        }
    }

    return $out;
}

it('maps every asset and liability subtype of the five charts to a class', function (): void {
    $lines = shippedChartLines();
    expect(array_unique(array_column($lines, 'chart')))->toHaveCount(5);

    $unmapped = [];
    foreach ($lines as $l) {
        if (! in_array($l['account_type'], ['asset', 'liability'], true)) {
            continue;
        }
        // The subtype must be known on its own, whatever the control type or element would say.
        if (BalanceSheetClassifier::bySubtype($l['account_type'], $l['account_subtype'], 'none') === null
            || BalanceSheetClassifier::classify($l['account_type'], $l['account_subtype'], $l['control_type'], [], $l['ifrs_element'] ?? null) === null) {
            $unmapped["{$l['chart']}: {$l['account_type']} / {$l['account_subtype']}"] = true;
        }
    }

    expect(array_keys($unmapped))->toBe([]);
});

it('fails on a subtype nobody mapped', function (): void {
    expect(BalanceSheetClassifier::bySubtype('asset', 'Mystery Assets', 'none'))->toBeNull()
        ->and(BalanceSheetClassifier::bySubtype('liability', 'Mystery Debts', 'none'))->toBeNull();
});

it('classifies the subtypes by IAS 1', function (): void {
    $c = fn (string $type, string $subtype, string $control = 'none', ?string $element = null, array $tags = []) => BalanceSheetClassifier::classify($type, $subtype, $control, $tags, $element);

    expect($c('asset', 'Cash & Equivalents'))->toBe(BalanceSheetClass::Current)
        ->and($c('asset', 'Inventory'))->toBe(BalanceSheetClass::Current)
        ->and($c('asset', 'Property, Plant & Equipment', 'fixed_asset'))->toBe(BalanceSheetClass::NonCurrent)
        ->and($c('asset', 'Contra Asset', 'accum_depr'))->toBe(BalanceSheetClass::NonCurrent)
        ->and($c('asset', 'Contra Asset'))->toBe(BalanceSheetClass::Current)
        ->and($c('liability', 'Borrowings'))->toBe(BalanceSheetClass::Current)
        ->and($c('liability', 'Borrowings', 'none', 'NoncurrentLeaseLiabilities'))->toBe(BalanceSheetClass::NonCurrent)
        ->and($c('liability', 'Non-current Liabilities'))->toBe(BalanceSheetClass::NonCurrent)
        ->and($c('asset', 'Current Assets', 'none', 'NoncurrentAssetsOrDisposalGroupsClassifiedAsHeldForSaleOrAsHeldForDistributionToOwners'))->toBe(BalanceSheetClass::Current)
        ->and($c('liability', 'Provisions', 'none', null, ['bs:non_current']))->toBe(BalanceSheetClass::NonCurrent)
        ->and($c('equity', 'Reserves'))->toBeNull();
});

it('keeps deferred tax non-current however the subtype or a tag reads', function (): void {
    foreach (['Tax Receivable', 'Current Assets', 'Non-current Assets', 'Anything'] as $subtype) {
        expect(BalanceSheetClassifier::classify('asset', $subtype, 'tax', ['bs:current'], 'DeferredTaxAssets'))->toBe(BalanceSheetClass::NonCurrent);
    }
    foreach (['Tax Payable', 'Current Liabilities', 'Anything'] as $subtype) {
        expect(BalanceSheetClassifier::classify('liability', $subtype, 'none', ['bs:current'], 'DeferredTaxLiabilities'))->toBe(BalanceSheetClass::NonCurrent);
    }
});

it('does not move deferred tax in the cash flow classifier', function (): void {
    // The comprehensive chart's deferred tax accounts keep their 'Tax Receivable' / 'Tax Payable' subtype.
    expect(CashFlowClassifier::classify('asset', 'Tax Receivable', 'none')->activity)->toBe(CashFlowActivity::Operating)
        ->and(CashFlowClassifier::classify('liability', 'Tax Payable', 'none')->activity)->toBe(CashFlowActivity::Operating);
});

it('presents current and non-current parts that add up to the totals', function (): void {
    $s = ReportScenario::create();
    $f = $s->f;
    foreach ([
        ['1350', 'Deferred tax asset', 'asset', 'debit', 'Tax Receivable', 'DeferredTaxAssets'],
        ['2350', 'Deferred tax liability', 'liability', 'credit', 'Tax Payable', 'DeferredTaxLiabilities'],
        ['2360', 'Current tax payable', 'liability', 'credit', 'Tax Payable', null],
    ] as [$code, $name, $type, $normal, $subtype, $element]) {
        $f->accounts[$code] = (string) Str::uuid7();
        DB::table('accounts')->insert([
            'id' => $f->accounts[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => $code, 'name' => $name,
            'account_type' => $type, 'account_subtype' => $subtype, 'normal_balance' => $normal, 'control_type' => 'none',
            'currency_policy' => 'base_only', 'allow_manual_journals' => true, 'ifrs_element' => $element,
        ]);
    }
    $s->story();
    $s->post('2026-02-20', [['1350', 7_000, 0], ['4000', 0, 7_000]]);
    $s->post('2026-02-21', [['5000', 9_000, 0], ['2350', 0, 4_000], ['2360', 0, 5_000]]);

    $bs = app(RunReport::class)('balance-sheet', $s->company(), ['as_of' => '2026-02-28', 'hide_zero' => true]);
    $total = fn (array $x): int => $x['total']['amount']['amount'];
    $codes = fn (array $part): array => collect($part['lines'])->pluck('account.code')->all();

    expect($codes($bs['assets']['non_current']))->toContain('1350', '1500', '1510')
        ->and($codes($bs['assets']['current']))->toContain('1000', '1100')->not->toContain('1350')
        ->and($codes($bs['liabilities']['non_current']))->toContain('2200', '2350')
        ->and($codes($bs['liabilities']['current']))->toContain('2000', '2360')->not->toContain('2350')
        ->and($total($bs['assets']['current']) + $total($bs['assets']['non_current']))->toBe($total($bs['assets']))
        ->and($total($bs['liabilities']['current']) + $total($bs['liabilities']['non_current']))->toBe($total($bs['liabilities']))
        ->and($bs['balanced'])->toBeTrue()
        ->and(collect($bs['assets']['lines'])->where('classification_assumed', true)->count())->toBe(0);

    // The deferred tax asset: 7,000 non-current, with fixed assets 30,000 less depreciation 1,000.
    expect($total($bs['assets']['non_current']))->toBe(36_000);
});
