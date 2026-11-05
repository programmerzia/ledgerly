<?php

declare(strict_types=1);

use App\Queries\Reports\DimensionBreakdown;
use App\Queries\Reports\RunReport;
use App\Support\Reports\Export\ReportTables;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Tests\Support\ReportScenario;

/*
 * 3c.19: trial balance (as of) and profit and loss broken down by one dimension. The columns are the dimension's
 * values with amounts plus an "untagged" column, and they add up exactly to the report without the breakdown.
 */

beforeEach(function (): void {
    $this->grant('periods.close', 'periods.year_end', 'periods.post_adjustment');
    $this->s = ReportScenario::create();
    $f = $this->s->f;
    $this->dimension = (string) Str::uuid7();
    DB::table('dimensions')->insert(['id' => $this->dimension, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'code' => 'DEPT', 'name' => 'Department', 'position' => 1]);
    $this->values = [];
    foreach (['SALES' => 'Sales', 'OPS' => 'Operations'] as $code => $name) {
        $this->values[$code] = (string) Str::uuid7();
        DB::table('dimension_values')->insert(['id' => $this->values[$code], 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'dimension_id' => $this->dimension, 'code' => $code, 'name' => $name]);
    }
    // Revenue and cost tagged to departments, some untagged; a balance sheet account tagged too.
    $s = $this->s;
    $s->post('2026-01-10', [['1000', 100_000, 0, [1 => $this->values['SALES']]], ['4000', 0, 100_000, [1 => $this->values['SALES']]]]);
    $s->post('2026-01-12', [['1000', 30_000, 0], ['4000', 0, 30_000]]);
    $s->post('2026-01-20', [['5000', 20_000, 0, [1 => $this->values['OPS']]], ['1000', 0, 20_000]]);
    $s->post('2026-02-02', [['5000', 7_000, 0, [1 => $this->values['SALES']]], ['5100', 3_000, 0], ['1000', 0, 10_000]]);
    $s->post('2026-02-03', [['1300', 9_000, 0, [1 => $this->values['OPS']]], ['1000', 0, 9_000]]);
});

/** Sum of the by_dimension cells of a figure. */
function columnSum(array $cells): int
{
    return array_sum(array_map(fn (array $m): int => $m['amount'], $cells));
}

it('splits profit and loss over the values and an untagged column that add up to the plain report', function (): void {
    $range = ['from' => '2026-01-01', 'to' => '2026-02-28'];
    $plain = app(RunReport::class)('profit-and-loss', $this->s->company(), $range);
    $by = app(RunReport::class)('profit-and-loss', $this->s->company(), $range + ['breakdown' => $this->dimension]);

    expect(collect($by['breakdown']['columns'])->pluck('value.code')->all())->toBe(['OPS', 'SALES', null])
        ->and($by['breakdown']['dimension']['name'])->toBe('Department');

    foreach ($by['sections'] as $i => $section) {
        foreach ($section['lines'] as $j => $line) {
            expect(columnSum($line['by_dimension']))->toBe($line['amount']['amount'])
                ->and($line['amount'])->toBe($plain['sections'][$i]['lines'][$j]['amount']);
        }
        expect(columnSum($section['total']['by_dimension']))->toBe($section['total']['amount']['amount'])
            ->and($section['total']['amount'])->toBe($plain['sections'][$i]['total']['amount']);
    }
    foreach (['gross_profit', 'operating_profit', 'net_profit'] as $k) {
        expect(columnSum($by['subtotals'][$k]['by_dimension']))->toBe($plain['subtotals'][$k]['amount']['amount'], $k);
    }

    // By hand: revenue SALES 100,000, untagged 30,000; operating expense OPS 20,000, SALES 7,000; cost of sales untagged 3,000.
    $revenue = collect($by['sections'])->firstWhere('key', 'operating_revenue')['total']['by_dimension'];
    $net = $by['subtotals']['net_profit']['by_dimension'];
    expect(array_column($revenue, 'amount'))->toBe([0, 100_000, 30_000])
        ->and(array_column($net, 'amount'))->toBe([-20_000, 93_000, 27_000])
        ->and($plain['subtotals']['net_profit']['amount']['amount'])->toBe(100_000);
});

it('keeps the dimension filter and sums to the filtered report', function (): void {
    $range = ['from' => '2026-01-01', 'to' => '2026-02-28', 'dimensions' => [$this->dimension => [$this->values['SALES']]]];
    $plain = app(RunReport::class)('profit-and-loss', $this->s->company(), $range);
    $by = app(RunReport::class)('profit-and-loss', $this->s->company(), $range + ['breakdown' => $this->dimension]);

    expect(collect($by['breakdown']['columns'])->pluck('value.code')->all())->toBe(['SALES', null])
        ->and(columnSum($by['subtotals']['net_profit']['by_dimension']))->toBe($plain['subtotals']['net_profit']['amount']['amount'])
        ->and($by['filtered'])->toBeTrue();
});

it('splits the as-of trial balance in signed nets that add up to each row and the totals', function (): void {
    $asOf = ['as_of' => '2026-02-28'];
    $plain = app(RunReport::class)('trial-balance', $this->s->company(), $asOf);
    $by = app(RunReport::class)('trial-balance', $this->s->company(), $asOf + ['breakdown' => $this->dimension]);

    expect($by['rows'])->toHaveCount(count($plain['rows']));
    foreach ($by['rows'] as $i => $row) {
        expect(columnSum($row['by_dimension']))->toBe($row['debit']['amount'] - $row['credit']['amount'], $row['account']['code'])
            ->and($row['debit'])->toBe($plain['rows'][$i]['debit']);
    }
    // Columns total the rows' nets: debits less credits is zero in every case, since each tagged line is a whole journal's part.
    expect(columnSum($by['totals']['by_dimension']))->toBe($plain['totals']['debit']['amount'] - $plain['totals']['credit']['amount'])
        ->and($by['totals']['debit'])->toBe($plain['totals']['debit'])
        ->and($by['balanced'])->toBe($plain['balanced']);
    $cash = collect($by['rows'])->firstWhere('account.code', '1000');
    expect(array_column($cash['by_dimension'], 'amount'))->toBe([0, 100_000, -9_000]);
});

it('refuses too many columns with a clear message, a comparison and the movement view', function (): void {
    $f = $this->s->f;
    foreach (range(1, DimensionBreakdown::MAX_COLUMNS + 1) as $n) {
        $id = (string) Str::uuid7();
        DB::table('dimension_values')->insert(['id' => $id, 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'dimension_id' => $this->dimension, 'code' => "X{$n}", 'name' => "Extra {$n}"]);
        $this->s->post('2026-03-01', [['1000', 100, 0], ['4000', 0, 100, [1 => $id]]]);
    }
    $range = ['from' => '2026-01-01', 'to' => '2026-03-31', 'breakdown' => $this->dimension];

    expect(fn () => app(RunReport::class)('profit-and-loss', $this->s->company(), $range))
        ->toThrow(ValidationException::class, 'at most 12 columns');
    // A shorter range stays within the cap.
    expect(app(RunReport::class)('profit-and-loss', $this->s->company(), ['to' => '2026-02-28'] + ['from' => '2026-01-01'] + ['breakdown' => $this->dimension])['breakdown']['columns'])->toHaveCount(3);
    expect(fn () => app(RunReport::class)('profit-and-loss', $this->s->company(), ['comparison' => 'previous_year'] + ['from' => '2026-01-01', 'to' => '2026-02-28', 'breakdown' => $this->dimension]))
        ->toThrow(ValidationException::class, 'comparison');
    expect(fn () => app(RunReport::class)('trial-balance', $this->s->company(), ['view' => 'movement', 'from' => '2026-01-01', 'to' => '2026-02-28', 'breakdown' => $this->dimension]))
        ->toThrow(ValidationException::class, 'as of a date');
});

it('refuses a dimension that is not the company\'s', function (): void {
    expect(fn () => app(RunReport::class)('profit-and-loss', $this->s->company(), ['from' => '2026-01-01', 'to' => '2026-02-28', 'breakdown' => (string) Str::uuid7()]))
        ->toThrow(ValidationException::class, 'does not exist');
});

it('exports the broken-down tables with the dimension in the title and a total column', function (): void {
    $by = app(RunReport::class)('profit-and-loss', $this->s->company(), ['from' => '2026-01-01', 'to' => '2026-02-28', 'breakdown' => $this->dimension]);
    $table = ReportTables::of('profit_and_loss', $by, 'Acme', 2);
    expect($table->title)->toBe('Profit and loss by Department')
        ->and(array_column($table->columns, 'label'))->toBe(['Account', 'Operations', 'Sales', 'Untagged', 'Total']);

    $tb = app(RunReport::class)('trial-balance', $this->s->company(), ['as_of' => '2026-02-28', 'breakdown' => $this->dimension]);
    $t = ReportTables::of('trial_balance', $tb, 'Acme', 2);
    expect(array_column($t->columns, 'label'))->toBe(['Code', 'Account', 'Operations', 'Sales', 'Untagged', 'Total']);
});
