<?php

declare(strict_types=1);

use App\Queries\Reports\RunReport;
use Tests\Support\ReportScenario;

/*
 * The January/February story of Tests\Support\ReportScenario, worked out by hand (cents). Totals as of
 * 28 Feb: cash 157,500; receivable 15,000 from A and 3,000 owed to customer B; payable 12,000 to S and
 * 4,000 owed by supplier T; fixed assets 30,000 less 1,000 depreciation; loan 50,000; capital 100,000;
 * profit 40,500 (January 42,000, February -1,500).
 */

beforeEach(function (): void {
    $this->grant('periods.close', 'periods.year_end', 'periods.post_adjustment');
    $this->s = ScenarioHelper::make();
});

/** Local factory so Pest's closure binding stays simple. */
final class ScenarioHelper
{
    public static function make(): ReportScenario
    {
        $s = ReportScenario::create();
        $s->story();

        return $s;
    }
}

function amountsByCode(array $section): array
{
    $out = [];
    foreach ($section['lines'] as $l) {
        $out[isset($l['account']) && ! isset($l['gross']) ? $l['account']['code'] : $l['key']] = $l['amount']['amount'];
    }

    return $out;
}

function run(object $test, string $report, array $input): array
{
    return app(RunReport::class)($report, $test->s->company(), $input);
}

it('produces the trial balance as of month end and mid-month, balanced', function (): void {
    $tb = run($this, 'trial-balance', ['period_id' => $this->s->periodId('2026-02-15'), 'hide_zero' => true]);
    $debit = collect($tb['rows'])->mapWithKeys(fn ($r) => [$r['account']['code'] => $r['debit']['amount']])->filter()->all();
    $credit = collect($tb['rows'])->mapWithKeys(fn ($r) => [$r['account']['code'] => $r['credit']['amount']])->filter()->all();

    expect($debit)->toBe(['1000' => 157_500, '1100' => 12_000, '1500' => 30_000, '5000' => 5_000, '5100' => 12_000, '6500' => 1_000, '6800' => 2_000])
        ->and($credit)->toBe(['1510' => 1_000, '2000' => 8_000, '2200' => 50_000, '3100' => 100_000, '4000' => 60_000, '4800' => 500])
        ->and($tb['totals']['debit']['amount'])->toBe(219_500)->and($tb['totals']['credit']['amount'])->toBe(219_500)
        ->and($tb['balanced'])->toBeTrue()->and($tb['as_of'])->toBe('2026-02-28');

    // 14 Feb is inside February: the partial month comes from journal lines.
    $mid = run($this, 'trial-balance', ['as_of' => '2026-02-14', 'hide_zero' => true]);
    $cash = collect($mid['rows'])->firstWhere('account.code', '1000');
    expect($cash['debit']['amount'])->toBe(158_500)->and($mid['balanced'])->toBeTrue();
});

it('produces the profit and loss by section for a month, year to date and with comparison', function (): void {
    $jan = run($this, 'profit-and-loss', ['period_id' => $this->s->periodId('2026-01-15'), 'hide_zero' => true]);
    $sections = collect($jan['sections'])->mapWithKeys(fn ($s) => [$s['key'] => $s['total']['amount']['amount']])->all();
    expect($sections)->toBe(['operating_revenue' => 60_000, 'direct_costs' => 12_000, 'operating_expense' => 6_000, 'other_income' => 0, 'other_expense' => 0])
        ->and($jan['subtotals']['gross_profit']['amount']['amount'])->toBe(48_000)
        ->and($jan['subtotals']['operating_profit']['amount']['amount'])->toBe(42_000)
        ->and($jan['subtotals']['net_profit']['amount']['amount'])->toBe(42_000);

    $feb = run($this, 'profit-and-loss', ['period_id' => $this->s->periodId('2026-02-15'), 'comparison' => 'previous_period', 'hide_zero' => true]);
    expect($feb['subtotals']['net_profit']['amount']['amount'])->toBe(-1_500)
        ->and($feb['subtotals']['net_profit']['comparison']['amount'])->toBe(42_000)
        ->and($feb['subtotals']['net_profit']['variance']['amount'])->toBe(-43_500)
        ->and($feb['subtotals']['net_profit']['variance_pct'])->toBe('-103.6')
        ->and(amountsByCode($feb['sections'][3]))->toBe(['4800' => 500])
        ->and(amountsByCode($feb['sections'][4]))->toBe(['6800' => 2_000]);

    $ytd = run($this, 'profit-and-loss', ['period_id' => $this->s->periodId('2026-02-15'), 'basis' => 'ytd', 'comparison' => 'previous_period']);
    expect($ytd['subtotals']['net_profit']['amount']['amount'])->toBe(40_500)
        ->and($ytd['subtotals']['net_profit']['comparison']['amount'])->toBe(42_000)
        ->and($ytd['from'])->toBe('2026-01-01');

    $none = run($this, 'profit-and-loss', ['period_id' => $this->s->periodId('2026-01-15'), 'comparison' => 'previous_period']);
    expect($none['comparison'])->toBe(['type' => 'previous_period', 'available' => false, 'from' => null, 'to' => null]);

    $custom = run($this, 'profit-and-loss', ['from' => '2026-01-26', 'to' => '2026-02-11']);
    expect($custom['subtotals']['net_profit']['amount']['amount'])->toBe(-20_000);   // 28 Jan cost of sales, 30 Jan depreciation, 31 Jan opex, 10 Feb interest
});

it('produces the balance sheet with receivables and payables presented gross (D9), balanced', function (): void {
    $bs = run($this, 'balance-sheet', ['period_id' => $this->s->periodId('2026-02-15'), 'hide_zero' => true]);

    expect(amountsByCode($bs['assets']))->toEqual([
        '1000' => 157_500, '1100' => 15_000, '1500' => 30_000, '1510' => -1_000, 'supplier_debit_balances:'.$this->s->f->account('2000') => 4_000,
    ])
        ->and(amountsByCode($bs['liabilities']))->toEqual([
            '2000' => 12_000, '2200' => 50_000, 'customer_credit_balances:'.$this->s->f->account('1100') => 3_000,
        ])
        ->and(amountsByCode($bs['equity']))->toEqual(['3100' => 100_000, 'current_year_result:' => 40_500])
        ->and($bs['assets']['total']['amount']['amount'])->toBe(205_500)
        ->and($bs['liabilities']['total']['amount']['amount'])->toBe(65_000)
        ->and($bs['equity']['total']['amount']['amount'])->toBe(140_500)
        ->and($bs['balanced'])->toBeTrue();

    $credit = collect($bs['liabilities']['lines'])->firstWhere('gross', true);
    expect($credit['contacts'])->toHaveCount(1)->and($credit['contacts'][0]['contact']['name'])->toBe('Customer B')
        ->and($credit['contacts'][0]['amount']['amount'])->toBe(3_000);

    $cmp = run($this, 'balance-sheet', ['period_id' => $this->s->periodId('2026-02-15'), 'comparison' => 'previous_period', 'hide_zero' => true]);
    expect(collect($cmp['assets']['lines'])->firstWhere('account.code', '1000')['comparison']['amount'])->toBe(135_000)
        ->and($cmp['equity']['total']['comparison']['amount'])->toBe(142_000);
});

it('produces the indirect cash flow, reconciled to the change in cash', function (): void {
    $jan = run($this, 'cash-flow', ['period_id' => $this->s->periodId('2026-01-15')]);
    expect($jan['operating']['total']['amount'])->toBe(15_000)
        ->and($jan['investing']['total']['amount'])->toBe(-30_000)
        ->and($jan['financing']['total']['amount'])->toBe(150_000)
        ->and($jan['net_change_in_cash']['amount'])->toBe(135_000)
        ->and($jan['opening_cash']['amount'])->toBe(0)->and($jan['closing_cash']['amount'])->toBe(135_000)
        ->and($jan['unexplained']['amount'])->toBe(0)->and($jan['reconciles'])->toBeTrue()
        ->and(collect($jan['operating']['lines'])->pluck('amount.amount', 'key')->all())->toMatchArray(['net_profit' => 42_000]);

    $feb = run($this, 'cash-flow', ['period_id' => $this->s->periodId('2026-02-15')]);
    expect($feb['operating']['total']['amount'])->toBe(22_500)->and($feb['investing']['total']['amount'])->toBe(0)
        ->and($feb['financing']['total']['amount'])->toBe(0)->and($feb['reconciles'])->toBeTrue()
        ->and($feb['opening_cash']['amount'])->toBe(135_000)->and($feb['closing_cash']['amount'])->toBe(157_500);

    $ytd = run($this, 'cash-flow', ['period_id' => $this->s->periodId('2026-02-15'), 'basis' => 'ytd']);
    expect($ytd['net_change_in_cash']['amount'])->toBe(157_500)->and($ytd['reconciles'])->toBeTrue();
});
