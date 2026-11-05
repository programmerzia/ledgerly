<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

/*
 * Plan 3c.15b: tax depreciation schedule. Mechanism only: classes are data, the schedule is a report, and nothing here posts.
 */

function ledgerFingerprint(): array
{
    adb('journals');

    return [
        'journals' => DB::table('journals')->count(), 'lines' => DB::table('journal_lines')->count(),
        'balances' => (int) DB::table('account_period_balances')->sum(DB::raw('debit + credit')), 'sequences' => DB::table('sequences')->sum('next_value'),
    ];
}

beforeEach(function (): void {
    $this->setUpAssets();
    $this->category = $this->assetCategory();
    $this->taxClass = fn (array $over = []) => $this->asPerson($this->accountant)->postJson($this->api('asset-tax-classes'), [
        'code' => 'CLASS-A', 'name' => 'Plant, 10% with 50% first year', 'annual_rate_bp' => 1000, 'first_year_rate_bp' => 5000, ...$over,
    ], $this->key());
    $this->classify = fn (array $asset, string $classId) => $this->asPerson($this->accountant)->putJson($this->api("fixed-assets/{$asset['id']}"), [
        'name' => $asset['name'], 'method' => 'straight_line', 'useful_life_months' => 120, 'tax_class_id' => $classId, 'version' => $asset['version'],
    ], $this->key())->assertOk()->json('data');
});

it('keeps classes as company data: a code, an annual rate, an optional first-year rate', function (): void {
    $class = ($this->taxClass)()->assertCreated()->json('data');

    expect($class)->toMatchArray(['code' => 'CLASS-A', 'annual_rate_bp' => 1000, 'first_year_rate_bp' => 5000, 'source' => 'company'])
        ->and(adb('asset_tax_classes')->count())->toBe(1);
    ($this->taxClass)()->assertStatus(422)->assertJsonPath('code', 'tax_class_code_taken');
    ($this->taxClass)(['code' => 'X', 'annual_rate_bp' => 0])->assertStatus(422)->assertJsonValidationErrors(['annual_rate_bp']);
    $updated = $this->asPerson($this->accountant)->putJson($this->api("asset-tax-classes/{$class['id']}"), ['name' => 'Renamed', 'annual_rate_bp' => 2000, 'version' => $class['version']], $this->key())->assertOk()->json('data');
    expect($updated['annual_rate_bp'])->toBe(2000)->and($updated['first_year_rate_bp'])->toBeNull();
});

it('gives tax written-down value per year for an asset with a class: 50% first year, then 10% of cost', function (): void {
    $class = ($this->taxClass)()->json('data');
    $asset = $this->capitalisedAsset($this->category['id']);
    ($this->classify)($asset, $class['id']);

    $report = $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/tax-schedule'))->assertOk()->json('data');
    $years = $report['assets'][0]['years'];

    expect($report['assets'][0])->toMatchArray(['number' => 'FA-00001', 'class_name' => 'Plant, 10% with 50% first year'])
        ->and(array_column($years, 'label'))->toBe(['FY2026', '2027', '2028', '2029', '2030', '2031'])
        ->and(array_map(fn ($y) => $y['allowance']['amount'], $years))->toBe([6000000, 1200000, 1200000, 1200000, 1200000, 1200000])
        ->and(array_map(fn ($y) => $y['written_down']['amount'], $years))->toBe([6000000, 4800000, 3600000, 2400000, 1200000, 0])
        ->and($report['by_year'][0]['written_down']['amount'])->toBe(6000000);

    $filtered = $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/tax-schedule?from_year=2028&to_year=2029'))->json('data');
    expect(array_column($filtered['assets'][0]['years'], 'year'))->toBe([2028, 2029]);
});

it('adds assets up by year, and leaves out assets with no class', function (): void {
    $class = ($this->taxClass)(['code' => 'B', 'name' => 'Plain 25%', 'annual_rate_bp' => 2500, 'first_year_rate_bp' => null])->json('data');
    $a = $this->capitalisedAsset($this->category['id'], ['name' => 'One'], 4000000, '2026-02-01');
    $b = $this->capitalisedAsset($this->category['id'], ['name' => 'Two'], 2000000, '2026-11-15');
    $this->capitalisedAsset($this->category['id'], ['name' => 'No class'], 1000000, '2026-03-01');
    ($this->classify)($a, $class['id']);
    ($this->classify)($b, $class['id']);

    $report = $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/tax-schedule'))->json('data');
    $byYear = collect($report['by_year'])->keyBy('year');

    expect($report['assets'])->toHaveCount(2)
        // Both start in 2026: One 1,000,000 a year, Two 500,000 a year, four years each.
        ->and($byYear[2026]['allowance']['amount'])->toBe(1500000)->and($byYear[2027]['written_down']['amount'])->toBe(3000000)
        ->and($byYear[2029]['written_down']['amount'])->toBe(0)->and(array_keys($byYear->all()))->toBe([2026, 2027, 2028, 2029]);
});

it('stops a disposed asset after the year of disposal', function (): void {
    $class = ($this->taxClass)(['first_year_rate_bp' => null])->json('data');
    $asset = $this->capitalisedAsset($this->category['id'], [], 12000000, '2026-01-10');
    ($this->classify)($asset, $class['id']);
    $this->postedRun('2026-01-15');
    $tx = $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
        'kind' => 'disposal', 'tx_date' => '2026-02-15', 'asset_id' => $asset['id'], 'proceeds' => 0,
    ], $this->key())->assertCreated()->json('data');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("asset-transactions/{$tx['id']}/submit"), [], $this->key())->assertOk();

    $report = $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/tax-schedule'))->json('data');
    expect($report['assets'][0]['stopped_after_year'])->toBe(2026)->and($report['assets'][0]['years'])->toHaveCount(1);
});

it('never touches the ledger: classes, assignment and the report change no journal, line, balance or number', function (): void {
    $asset = $this->capitalisedAsset($this->category['id']);
    $before = ledgerFingerprint();
    $auditBefore = adb('audit_events')->where('action', 'like', 'journal%')->count();

    $class = ($this->taxClass)()->assertCreated()->json('data');
    ($this->classify)($asset, $class['id']);
    $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/tax-schedule'))->assertOk();
    $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/tax-schedule?from_year=2027'))->assertOk();

    expect(ledgerFingerprint())->toBe($before)->and(adb('audit_events')->where('action', 'like', 'journal%')->count())->toBe($auditBefore)
        ->and(adb('asset_movements')->where('asset_id', $asset['id'])->count())->toBe(1);
});

it('needs the permissions', function (): void {
    $this->asPerson($this->approver)->postJson($this->api('asset-tax-classes'), ['code' => 'X', 'name' => 'x', 'annual_rate_bp' => 1000], $this->key())->assertForbidden();
    $this->asPerson($this->assistant)->getJson($this->api('fixed-assets/tax-schedule'))->assertForbidden();
    $this->asPerson($this->approver)->getJson($this->api('fixed-assets/tax-schedule'))->assertOk();
});
