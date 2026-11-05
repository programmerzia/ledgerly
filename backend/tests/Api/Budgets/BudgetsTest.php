<?php

declare(strict_types=1);

use App\Support\Reports\LedgerVersion;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\Support\ImportsApi;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

uses(MakesApiCalls::class, TradeApi::class, ImportsApi::class);

/*
 * Budgets (D15 item 5): versions per fiscal year, a sparse grid in integer minor units, maker-checker approval, one approved version a
 * year, read-only once approved (also in the database), and budget vs actual from the real ledger with drill and exports.
 */

beforeEach(function (): void {
    $this->setUpTrade();
});

/** The fiscal year and its regular periods keyed by month number. */
function budgetYear(object $test): array
{
    return (fn () => $this->inTenant(fn () => [
        'year' => DB::table('fiscal_years')->where('company_id', $this->f->companyId)->value('id'),
        'periods' => DB::table('fiscal_periods')->where('company_id', $this->f->companyId)->where('kind', 'regular')->orderBy('number')->pluck('id', 'number')->all(),
    ]))->call($test);
}

function makeBudget(object $test, string $name = 'Plan', ?string $copyFrom = null, $by = null): array
{
    return (function () use ($name, $copyFrom, $by) {
        $y = budgetYear($this);
        $body = ['name' => $name, 'fiscal_year_id' => $y['year']] + ($copyFrom === null ? [] : ['copy_from_budget_id' => $copyFrom]);

        return $this->asPerson($by ?? $this->accountant)->postJson($this->api('budgets'), $body, $this->key())->assertCreated()->json('data');
    })->call($test);
}

function saveCells(object $test, array $budget, array $cells, $by = null): TestResponse
{
    return (fn () => $this->asPerson($by ?? $this->accountant)->putJson($this->api("budgets/{$budget['id']}/lines"), ['version' => $budget['version'], 'cells' => $cells], $this->key()))->call($test);
}

function cell(object $test, string $code, int $month, int $amount, array $dims = []): array
{
    $y = budgetYear($test);

    return ['account_id' => $test->f->account($code), 'fiscal_period_id' => $y['periods'][$month], 'amount' => $amount] + ($dims === [] ? [] : ['dimensions' => $dims]);
}

function approvedBudget(object $test, array $cells): array
{
    $budget = makeBudget($test);
    $saved = saveCells($test, $budget, $cells)->assertOk()->json('data');

    return (fn () => $this->asPerson($this->approver)->postJson($this->api("budgets/{$saved['id']}/approve"), ['version' => $saved['version']], $this->key())->assertOk()->json('data'))->call($test);
}

it('creates numbered draft versions of a fiscal year, and shows the grid', function (): void {
    $a = makeBudget($this, 'FY2026 plan');
    $b = makeBudget($this, 'FY2026 stretch');
    expect($a['revision'])->toBe(1)->and($a['status'])->toBe('draft')->and($b['revision'])->toBe(2)->and($a['version'])->toBe(0)
        ->and($a['can']['update'])->toBeTrue()->and($a['can']['approve'])->toBeFalse();

    $this->asPerson($this->accountant)->getJson($this->api('budgets'))->assertOk()->assertJsonCount(2, 'data');
    $show = $this->asPerson($this->accountant)->getJson($this->api("budgets/{$a['id']}"))->assertOk();
    expect($show->json('grid.periods'))->toHaveCount(12)->and($show->json('grid.lines'))->toBe([]);

    // Viewers read, only people with budgets.manage create.
    $viewer = $this->person('Vera Viewer', ['Viewer']);
    $this->asPerson($viewer)->getJson($this->api('budgets'))->assertOk();
    $this->asPerson($viewer)->postJson($this->api('budgets'), ['name' => 'X', 'fiscal_year_id' => budgetYear($this)['year']], $this->key())->assertForbidden();
    $this->asPerson($this->assistant)->getJson($this->api('budgets'))->assertForbidden();
});

it('saves cells in whole minor units, clears a cell with 0, and keeps profit and loss accounts only', function (): void {
    $budget = makeBudget($this);
    $saved = saveCells($this, $budget, [cell($this, '4000', 1, 100000), cell($this, '4000', 2, 120000), cell($this, '5000', 1, 40000)])->assertOk()
        ->assertJsonPath('meta.written', 3)->assertJsonPath('data.version', 1)->json('data');

    $grid = $this->asPerson($this->accountant)->getJson($this->api("budgets/{$budget['id']}"))->json('grid.lines');
    expect($grid)->toHaveCount(3)->and(array_sum(array_column($grid, 'amount')))->toBe(260000);

    // A stale version is a conflict that names the server's version.
    saveCells($this, $budget, [cell($this, '4000', 3, 1)])->assertStatus(409)->assertJsonPath('code', 'version_conflict');

    saveCells($this, $saved, [cell($this, '4000', 2, 0)])->assertOk()->assertJsonPath('meta.deleted', 1);
    expect($this->asPerson($this->accountant)->getJson($this->api("budgets/{$budget['id']}"))->json('grid.lines'))->toHaveCount(2);

    // Balance sheet accounts, fractions and amounts beyond the range are refused.
    $saved = $this->asPerson($this->accountant)->getJson($this->api("budgets/{$budget['id']}"))->json('data');
    saveCells($this, $saved, [cell($this, '1000', 1, 5000)])->assertStatus(422)->assertJsonPath('code', 'budget_account_type_invalid');
    saveCells($this, $saved, [['account_id' => $this->f->account('4000'), 'fiscal_period_id' => budgetYear($this)['periods'][1], 'amount' => 10.5]])->assertStatus(422);
    saveCells($this, $saved, [cell($this, '4000', 1, 1_000_000_000_000_000)])->assertStatus(422);
    // Nothing was written by the refused saves.
    expect($this->asPerson($this->accountant)->getJson($this->api("budgets/{$budget['id']}"))->json('data.version'))->toBe($saved['version']);
});

it('spreads an annual total in integer minor units with the remainder in the last month', function (): void {
    $budget = makeBudget($this);
    $r = $this->asPerson($this->accountant)->getJson($this->api("budgets/{$budget['id']}/spread?total=100000"))->assertOk()->json('data');
    $amounts = array_column($r, 'amount');
    expect($amounts)->toHaveCount(12)->and(array_slice($amounts, 0, 11))->each->toBe(8333)->and($amounts[11])->toBe(8337)->and(array_sum($amounts))->toBe(100000);

    $neg = array_column($this->asPerson($this->accountant)->getJson($this->api("budgets/{$budget['id']}/spread?total=-100000"))->json('data'), 'amount');
    expect($neg[0])->toBe(-8333)->and($neg[11])->toBe(-8337)->and(array_sum($neg))->toBe(-100000);
    $this->asPerson($this->accountant)->getJson($this->api("budgets/{$budget['id']}/spread?total=12.5"))->assertStatus(422);
});

it('is approved by someone other than its maker, becomes read-only, and is protected in the database too', function (): void {
    $budget = makeBudget($this);
    $saved = saveCells($this, $budget, [cell($this, '4000', 1, 100000)])->json('data');

    // Maker is an owner: the same person cannot approve; an accountant has no approve right.
    $mine = makeBudget($this, 'Owner draft', by: $this->owner);
    saveCells($this, $mine, [cell($this, '4000', 1, 5)], $this->owner)->assertOk();
    $mine = $this->asPerson($this->owner)->getJson($this->api("budgets/{$mine['id']}"))->json('data');
    $this->asPerson($this->owner)->postJson($this->api("budgets/{$mine['id']}/approve"), ['version' => $mine['version']], $this->key())->assertForbidden();
    $this->asPerson($this->accountant)->postJson($this->api("budgets/{$saved['id']}/approve"), ['version' => $saved['version']], $this->key())->assertForbidden();
    // An empty budget cannot be approved.
    $empty = makeBudget($this, 'Empty');
    $this->asPerson($this->approver)->postJson($this->api("budgets/{$empty['id']}/approve"), ['version' => $empty['version']], $this->key())->assertStatus(422)->assertJsonPath('code', 'budget_empty');

    $approved = $this->asPerson($this->approver)->postJson($this->api("budgets/{$saved['id']}/approve"), ['version' => $saved['version']], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'approved')->assertJsonPath('data.approved_by', $this->approver->id)->json('data');

    saveCells($this, $approved, [cell($this, '4000', 2, 1)])->assertForbidden();   // the policy refuses before the Action (which checks again)
    $this->asPerson($this->accountant)->putJson($this->api("budgets/{$approved['id']}"), ['name' => 'Renamed', 'version' => $approved['version']], $this->key())->assertForbidden();
    $this->asPerson($this->accountant)->deleteJson($this->api("budgets/{$approved['id']}"), ['version' => $approved['version']], $this->key())->assertForbidden();

    // Below the Action: the database refuses to change the cells or the header of an approved budget.
    $change = fn (callable $sql) => $this->inTenant(function () use ($sql): void {
        try {
            DB::transaction($sql);
        } catch (Throwable $e) {
            throw new RuntimeException('refused: '.($e->getCode() ?: $e->getMessage()));
        }
    });
    expect(fn () => $change(fn () => DB::table('budget_lines')->where('budget_id', $approved['id'])->update(['amount' => 1])))->toThrow(RuntimeException::class, 'LG020');
    expect(fn () => $change(fn () => DB::table('budget_lines')->where('budget_id', $approved['id'])->delete()))->toThrow(RuntimeException::class, 'LG020');
    expect(fn () => $change(fn () => DB::table('budgets')->where('id', $approved['id'])->update(['name' => 'Tampered'])))->toThrow(RuntimeException::class, 'LG020');
    expect(fn () => $change(fn () => DB::table('budgets')->where('id', $approved['id'])->delete()))->toThrow(RuntimeException::class, 'LG020');
    expect($this->inTenant(fn () => DB::table('budget_lines')->where('budget_id', $approved['id'])->value('amount')))->toBe(100000);
});

it('keeps one approved version a year: a revision is a copy that archives the earlier approval', function (): void {
    $v1 = approvedBudget($this, [cell($this, '4000', 1, 100000), cell($this, '5000', 1, 30000)]);
    $v2 = makeBudget($this, 'Revision', copyFrom: $v1['id']);
    expect($v2['revision'])->toBe(2)->and($v2['status'])->toBe('draft')->and($v2['copied_from_id'])->toBe($v1['id'])->and($v2['line_count'])->toBe(2);

    $v2 = saveCells($this, $v2, [cell($this, '4000', 1, 150000)])->assertOk()->json('data');
    $this->asPerson($this->approver)->postJson($this->api("budgets/{$v2['id']}/approve"), ['version' => $v2['version']], $this->key())->assertOk();

    $list = collect($this->asPerson($this->accountant)->getJson($this->api('budgets'))->json('data'))->keyBy('revision');
    expect($list[1]['status'])->toBe('archived')->and($list[2]['status'])->toBe('approved');
    expect($this->inTenant(fn () => DB::table('budgets')->where('status', 'approved')->count()))->toBe(1);
    // The earlier version's figures are as they were.
    expect($this->inTenant(fn () => (int) DB::table('budget_lines')->where('budget_id', $v1['id'])->where('account_id', $this->f->account('4000'))->value('amount')))->toBe(100000);

    // A draft can be discarded; an approved one cannot.
    $draft = makeBudget($this, 'Throwaway');
    $this->asPerson($this->accountant)->deleteJson($this->api("budgets/{$draft['id']}"), ['version' => $draft['version']], $this->key())->assertNoContent();
    $this->asPerson($this->accountant)->getJson($this->api("budgets/{$draft['id']}"))->assertNotFound();
});

it('reports budget against the real ledger by month and year to date, with variance, favourability and a drill that lands on the lines', function (): void {
    $this->sale(100000, '2026-03-15');                 // revenue 100,000 in March
    $this->sale(50000, '2026-02-10');                  // revenue 50,000 in February
    $this->postedDoc('bills', $this->t->body($this->t->supplier, [[30000, '1', null, null, '5000']], '2026-03-18'));   // expense 30,000 in March
    $budget = approvedBudget($this, [
        cell($this, '4000', 2, 60000), cell($this, '4000', 3, 80000), cell($this, '5000', 3, 20000), cell($this, '5000', 2, 5000),
    ]);
    $march = budgetYear($this)['periods'][3];

    $month = $this->asPerson($this->accountant)->getJson($this->api("reports/budget-vs-actual?period_id={$march}&basis=month"))->assertOk()->json('data');
    $rev = collect($month['sections'])->firstWhere('key', 'operating_revenue');
    $exp = collect($month['sections'])->firstWhere('key', 'operating_expense');
    expect($month['budget']['id'])->toBe($budget['id'])
        ->and($rev['lines'][0]['budget']['amount'])->toBe(80000)->and($rev['lines'][0]['actual']['amount'])->toBe(100000)
        ->and($rev['lines'][0]['variance']['amount'])->toBe(20000)->and($rev['lines'][0]['variance_pct'])->toBe('25.0')->and($rev['lines'][0]['favourable'])->toBeTrue()
        ->and($exp['lines'][0]['budget']['amount'])->toBe(20000)->and($exp['lines'][0]['actual']['amount'])->toBe(30000)
        ->and($exp['lines'][0]['variance']['amount'])->toBe(10000)->and($exp['lines'][0]['variance_pct'])->toBe('50.0')->and($exp['lines'][0]['favourable'])->toBeFalse()
        ->and($month['subtotals']['net_profit']['budget']['amount'])->toBe(60000)->and($month['subtotals']['net_profit']['actual']['amount'])->toBe(70000)
        ->and($month['subtotals']['net_profit']['favourable'])->toBeTrue();

    $ytd = $this->asPerson($this->accountant)->getJson($this->api("reports/budget-vs-actual?period_id={$march}&basis=ytd"))->assertOk()->json('data');
    $revYtd = collect($ytd['sections'])->firstWhere('key', 'operating_revenue')['lines'][0];
    expect($revYtd['budget']['amount'])->toBe(140000)->and($revYtd['actual']['amount'])->toBe(150000)->and($revYtd['variance_pct'])->toBe('7.1');   // 10,000 / 140,000 = 7.142...% -> 7.1

    // The drill key opens exactly the lines behind the figure.
    $drill = $this->asPerson($this->accountant)->getJson($this->api('reports/drill?'.http_build_query($revYtd['drill'])))->assertOk();
    expect($drill->json('summary.net.amount'))->toBe(-150000);

    // The same figures leave through the existing export path.
    $csv = $this->asPerson($this->accountant)->get($this->api("reports/budget-vs-actual/export?period_id={$march}&basis=ytd&format=csv"))->assertOk()->streamedContent();
    expect($csv)->toContain('Budget vs actual')->toContain('Variance %')->toContain('1500.00')->toContain('Favourable')->toContain('Adverse');

    // Reading needs budgets.view as well as reports.view.
    $this->asPerson($this->assistant)->getJson($this->api("reports/budget-vs-actual?period_id={$march}&basis=month"))->assertForbidden();
    // No period, no report.
    $this->asPerson($this->accountant)->getJson($this->api('reports/budget-vs-actual?from=2026-01-01&to=2026-03-31'))->assertStatus(422);
    expect($this->inTenant(fn () => LedgerChecks::problems()))->toBe([]);
});

it('does not bump the ledger version when a budget changes, and the report cache follows the budget version', function (): void {
    $this->sale(100000, '2026-03-15');
    $march = budgetYear($this)['periods'][3];
    $draft = makeBudget($this);
    $draft = saveCells($this, $draft, [cell($this, '4000', 3, 80000)])->json('data');
    $versions = fn () => app(LedgerVersion::class)->current($this->f->tenantId, $this->f->companyId);
    $before = $versions();

    $url = "reports/budget-vs-actual?period_id={$march}&basis=month&budget_id={$draft['id']}";
    $one = $this->asPerson($this->accountant)->getJson($this->api($url))->assertOk()->json('data');
    $again = saveCells($this, $draft, [cell($this, '4000', 3, 90000)])->json('data');
    $two = $this->asPerson($this->accountant)->getJson($this->api($url))->assertOk()->json('data');

    expect($versions())->toBe($before)
        ->and($one['sections'][0]['lines'][0]['budget']['amount'])->toBe(80000)->and($two['sections'][0]['lines'][0]['budget']['amount'])->toBe(90000)
        ->and($two['budget']['version'])->toBe($again['version']);
    // Approval changes what the default report reads, again without touching the ledger version.
    $this->asPerson($this->accountant)->getJson($this->api("reports/budget-vs-actual?period_id={$march}&basis=month"))->assertStatus(422)->assertJsonPath('code', 'budget_not_approved');
    $this->asPerson($this->approver)->postJson($this->api("budgets/{$again['id']}/approve"), ['version' => $again['version']], $this->key())->assertOk();
    $this->asPerson($this->accountant)->getJson($this->api("reports/budget-vs-actual?period_id={$march}&basis=month"))->assertOk();
    expect($versions())->toBe($before);
});

it('filters budget and actual by dimension value, and shows the dashboard note only when a budget is approved', function (): void {
    $this->asPerson($this->accountant)->getJson($this->api('budgets/dashboard-card'))->assertOk()->assertJsonPath('data', null);

    $ids = $this->inTenant(function (): array {
        $dim = (string) Str::uuid7();
        DB::table('dimensions')->insert(['id' => $dim, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'code' => 'DEPT', 'name' => 'Department', 'position' => 1]);
        $values = [];
        foreach (['NORTH', 'SOUTH'] as $code) {
            $values[$code] = (string) Str::uuid7();
            DB::table('dimension_values')->insert(['id' => $values[$code], 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'dimension_id' => $dim, 'code' => $code, 'name' => $code]);
        }

        return ['dim' => $dim] + $values;
    });
    $north = [$ids['dim'] => $ids['NORTH']];
    $south = [$ids['dim'] => $ids['SOUTH']];
    foreach ([[70000, $north], [30000, $south]] as [$price, $dims]) {
        $b = $this->t->body($this->t->customer, [[$price, '1', 'VAT10']], '2026-03-15');
        $b['lines'][0]['dimensions'] = $dims;
        $this->postedDoc('invoices', $b);
    }
    $budget = approvedBudget($this, [cell($this, '4000', 3, 60000, $north), cell($this, '4000', 3, 50000, $south)]);
    $march = budgetYear($this)['periods'][3];

    $all = $this->asPerson($this->accountant)->getJson($this->api("reports/budget-vs-actual?period_id={$march}&basis=month"))->json('data.sections.0.lines.0');
    expect($all['budget']['amount'])->toBe(110000)->and($all['actual']['amount'])->toBe(100000);
    $filtered = $this->asPerson($this->accountant)->getJson($this->api("reports/budget-vs-actual?period_id={$march}&basis=month&dimensions[{$ids['dim']}]={$ids['NORTH']}"))->assertOk()->json('data');
    $line = $filtered['sections'][0]['lines'][0];
    expect($line['budget']['amount'])->toBe(60000)->and($line['actual']['amount'])->toBe(70000)->and($line['favourable'])->toBeTrue()->and($filtered['filtered'])->toBeTrue()
        ->and($line['drill']['dimensions'])->toBe([$ids['dim'] => [$ids['NORTH']]]);

    // A value that does not exist is refused.
    saveCells($this, makeBudget($this, 'Bad dim'), [cell($this, '4000', 1, 5, [$ids['dim'] => (string) Str::uuid7()])])->assertStatus(422)->assertJsonPath('code', 'dimension_value_invalid');

    $card = $this->asPerson($this->accountant)->getJson($this->api('budgets/dashboard-card'))->assertOk()->json('data');
    expect($card['budget']['id'])->toBe($budget['id'])->and($card['basis'])->toBe('ytd')->and($card['revenue']['actual']['amount'])->toBe(100000)
        ->and($card['revenue']['budget']['amount'])->toBe(110000)->and($card['net_profit']['favourable'])->toBeFalse();
});

it('exports the grid as CSV in decimals', function (): void {
    $budget = makeBudget($this);
    $saved = saveCells($this, $budget, [cell($this, '4000', 1, 123456), cell($this, '4000', 2, 100)])->json('data');
    $csv = $this->asPerson($this->accountant)->get($this->api("budgets/{$saved['id']}/export?format=csv"))->assertOk()->streamedContent();
    expect($csv)->toContain('Code,Account,Dimensions')->toContain('4000,Sales')->toContain('1234.56')->toContain('1.00')->toContain('1235.56');
    $this->asPerson($this->assistant)->get($this->api("budgets/{$saved['id']}/export?format=csv"))->assertForbidden();
});

it('imports budget amounts through the framework: validated preview, then one atomic apply', function (): void {
    $budget = makeBudget($this);
    $csv = "Account,Month,Amount\n4000,1,1000.00\n4000,2,1200.50\n5000,Mar,300\n5000,2026-04-20,310\n";
    $map = ['account' => 'Account', 'period' => 'Month', 'amount' => 'Amount'];

    // Row 3 names a period that does not exist ('Mar' is not a period name here); nothing is applied while a row is wrong.
    $bad = $this->previewed('budget_lines', $csv, $map, ['budget_id' => $budget['id']], $this->accountant);
    expect($bad['rows_invalid'])->toBe(1)->and($bad['rows_valid'])->toBe(3);

    $names = $this->inTenant(fn () => DB::table('fiscal_periods')->where('company_id', $this->f->companyId)->where('number', 3)->value('name'));
    $good = $this->previewed('budget_lines', str_replace('Mar', $names, $csv), $map, ['budget_id' => $budget['id']], $this->accountant);
    expect($good['rows_invalid'])->toBe(0)->and($good['rows_valid'])->toBe(4);

    $this->requestApply($good['id'], $this->accountant, signing: false)->assertStatus(202);
    $this->runJob($good['id']);
    $grid = $this->asPerson($this->accountant)->getJson($this->api("budgets/{$budget['id']}"))->json('grid.lines');
    expect($grid)->toHaveCount(4)->and(array_sum(array_column($grid, 'amount')))->toBe(100000 + 120050 + 30000 + 31000);

    // An account that is not income or expense, or a repeated cell, is a row error in the preview.
    $worse = $this->previewed('budget_lines', "Account,Month,Amount\n1000,1,5\n4000,1,7\n4000,1,8\n", $map, ['budget_id' => $budget['id']], $this->accountant);
    expect($worse['rows_invalid'])->toBe(2);
});
