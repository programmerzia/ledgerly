<?php

declare(strict_types=1);

use Illuminate\Database\QueryException;
use Tests\Support\LedgerChecks;

/*
 * Plan 3c.13: categories, the register, opening assets, capitalising from a posted line (no second posting, no double
 * capitalising) and the register-to-ledger check. Amounts are minor units: 12,000,000 is 120,000.00.
 */

beforeEach(function (): void {
    $this->setUpAssets();
    $this->category = $this->assetCategory();
});

it('creates a category only on the right kinds of account, and not twice under one name', function (): void {
    $accountant = $this->accountant;
    $body = ['name' => 'Vehicles', 'asset_account_id' => $this->f->account('1000'), 'accumulated_account_id' => $this->f->account('1510'), 'expense_account_id' => $this->f->account('6500')];
    $this->asPerson($accountant)->postJson($this->api('asset-categories'), $body, $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'asset_account_wrong_control');
    $this->asPerson($accountant)->postJson($this->api('asset-categories'), [...$body, 'asset_account_id' => $this->f->account('1500'), 'expense_account_id' => $this->f->account('1000')], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'asset_account_wrong_type');
    $this->asPerson($accountant)->postJson($this->api('asset-categories'), ['name' => 'Equipment', 'asset_account_id' => $this->f->account('1500'), 'accumulated_account_id' => $this->f->account('1510'), 'expense_account_id' => $this->f->account('6500')], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'asset_category_name_taken');

    expect($this->category['measurement_model'])->toBe('cost')->and($this->category['default_life_months'])->toBe(120);
});

it('freezes a category\'s accounts once it has assets', function (): void {
    $this->capitalisedAsset($this->category['id']);
    $this->asPerson($this->accountant)->putJson($this->api("asset-categories/{$this->category['id']}"), [
        'name' => 'Equipment', 'asset_account_id' => $this->f->account('1520'), 'accumulated_account_id' => $this->f->account('1510'),
        'expense_account_id' => $this->f->account('6500'), 'version' => $this->category['version'],
    ], $this->key())->assertStatus(422)->assertJsonPath('code', 'asset_category_in_use');
});

it('capitalises a posted journal line: the register entry is linked to it and nothing is posted', function (): void {
    [$journalId, $line] = $this->assetPurchaseJournal();
    $journals = adb('journals')->count();

    $asset = $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Press', 'category_id' => $this->category['id'], 'source_type' => 'journal_line', 'source_id' => $line, 'useful_life_months' => 120, 'residual' => 0,
    ], $this->key())->assertCreated()->json('data');

    expect($asset['number'])->toBe('FA-00001')->and($asset['cost']['amount'])->toBe(12000000)->and($asset['acquired_on'])->toBe('2026-03-20')
        ->and($asset['available_from'])->toBe('2026-03-20')->and($asset['source_journal_id'])->toBe($journalId)->and($asset['status'])->toBe('active')
        ->and($asset['accumulated_depreciation']['amount'])->toBe(0)->and($asset['carrying_amount']['amount'])->toBe(12000000)
        ->and(adb('journals')->count())->toBe($journals);
    $movement = adb('asset_movements')->where('asset_id', $asset['id'])->get();
    expect($movement)->toHaveCount(1)->and($movement[0]->kind)->toBe('addition')->and((int) $movement[0]->cost_delta)->toBe(12000000)->and($movement[0]->journal_id)->toBe($journalId);
});

it('does not capitalise the same line twice', function (): void {
    [, $line] = $this->assetPurchaseJournal();
    $body = ['name' => 'Press', 'category_id' => $this->category['id'], 'source_type' => 'journal_line', 'source_id' => $line, 'useful_life_months' => 120];
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), $body, $this->key())->assertCreated();
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), $body, $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'asset_already_capitalised');

    expect(adb('fixed_assets')->count())->toBe(1);
});

it('capitalises a posted bill line on a fixed asset account', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[250000, '2', null, '0', '1500']], '2026-04-02'));
    $line = adb('invoice_lines')->where('invoice_id', $bill['id'])->value('id');

    $asset = $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Two lathes', 'category_id' => $this->category['id'], 'source_type' => 'bill_line', 'source_id' => $line, 'useful_life_months' => 60,
    ], $this->key())->assertCreated()->json('data');

    expect($asset['cost']['amount'])->toBe(500000)->and($asset['acquired_on'])->toBe('2026-04-02')->and($asset['source_type'])->toBe('bill_line')
        ->and($asset['source_journal_id'])->toBe($bill['journal_id']);
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Again', 'category_id' => $this->category['id'], 'source_type' => 'bill_line', 'source_id' => $line, 'useful_life_months' => 60,
    ], $this->key())->assertStatus(422)->assertJsonPath('code', 'asset_already_capitalised');
});

it('refuses a source line on the wrong account, an unposted line, or a register entry with no source and no opening figures', function (): void {
    [, $land] = $this->assetPurchaseJournal(5000000, '2026-03-21', '1520');
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Plot', 'category_id' => $this->category['id'], 'source_type' => 'journal_line', 'source_id' => $land, 'useful_life_months' => 120,
    ], $this->key())->assertStatus(422)->assertJsonPath('code', 'asset_source_account_mismatch');

    $cash = adb('journal_lines')->where('account_id', $this->f->account('1000'))->value('id');
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Cash', 'category_id' => $this->category['id'], 'source_type' => 'journal_line', 'source_id' => $cash, 'useful_life_months' => 120,
    ], $this->key())->assertStatus(422)->assertJsonPath('code', 'asset_source_not_fixed_asset');

    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Nothing', 'category_id' => $this->category['id'], 'cost' => 100000, 'useful_life_months' => 120,
    ], $this->key())->assertStatus(422)->assertJsonPath('code', 'asset_source_required');
});

it('needs the estimates its method needs', function (): void {
    [, $line] = $this->assetPurchaseJournal();
    $bare = $this->assetCategory(['name' => 'Bare', 'default_life_months' => null]);
    $body = ['name' => 'Press', 'category_id' => $bare['id'], 'source_type' => 'journal_line', 'source_id' => $line];
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [...$body, 'useful_life_months' => null, 'method' => 'straight_line'], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'asset_life_required');
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [...$body, 'method' => 'declining_balance'], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'asset_rate_required');
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [...$body, 'method' => 'units_of_production'], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'asset_units_required');
});

it('brings in an opening asset with accumulated depreciation to date and posts nothing', function (): void {
    $journals = adb('journals')->count();
    // Cost 120,000.00 bought 2025-01-10, 10-year life; 12 months charged to go-live on 2026-01-01: 12,000.00 accumulated.
    $asset = $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Old press', 'category_id' => $this->category['id'], 'cost' => 12000000, 'acquired_on' => '2025-01-10',
        'opening_accumulated' => 1200000, 'opening_as_of' => '2026-01-01', 'useful_life_months' => 120,
    ], $this->key())->assertCreated()->json('data');

    expect($asset['is_opening'])->toBeTrue()->and($asset['opening_accumulated']['amount'])->toBe(1200000)->and($asset['accumulated_depreciation']['amount'])->toBe(1200000)
        ->and($asset['carrying_amount']['amount'])->toBe(10800000)->and($asset['months_charged'])->toBe(12)->and($asset['depreciated_through'])->toBe('2025-12-31')
        ->and($asset['source_type'])->toBeNull()->and(adb('journals')->count())->toBe($journals);
    $m = adb('asset_movements')->where('asset_id', $asset['id'])->first();
    expect($m->kind)->toBe('opening')->and((int) $m->depreciation_delta)->toBe(1200000)->and($m->journal_id)->toBeNull();

    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Too much', 'category_id' => $this->category['id'], 'cost' => 12000000, 'acquired_on' => '2025-01-10',
        'opening_accumulated' => 12000001, 'opening_as_of' => '2026-01-01', 'useful_life_months' => 120,
    ], $this->key())->assertStatus(422)->assertJsonPath('code', 'asset_opening_accumulated_invalid');
});

it('reconciles the register to the ledger, and shows a difference when a posting bypasses the register', function (): void {
    $this->capitalisedAsset($this->category['id']);
    $check = fn () => $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/reconciliation?as_of=2026-03-31'))->assertOk()->json('data');

    $r = $check();
    $cost = collect($r['rows'])->firstWhere('kind', 'cost');
    expect($r['reconciles'])->toBeTrue()->and($cost['register']['amount'])->toBe(12000000)->and($cost['ledger']['amount'])->toBe(12000000)->and($cost['difference']['amount'])->toBe(0);

    // A second purchase posted to the asset account but never capitalised: the ledger is ahead of the register.
    $this->assetPurchaseJournal(300000, '2026-03-25');
    $r = $check();
    $cost = collect($r['rows'])->firstWhere('kind', 'cost');
    expect($r['reconciles'])->toBeFalse()->and($cost['difference']['amount'])->toBe(-300000);

    // ...and it shows up as a line waiting to be capitalised.
    $waiting = $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/capitalisable'))->assertOk()->json('data');
    expect($waiting)->toHaveCount(1)->and($waiting[0]['amount']['amount'])->toBe(300000);
});

it('shows the opening accumulated depreciation as its own figure on the accumulated account', function (): void {
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), [
        'name' => 'Old press', 'category_id' => $this->category['id'], 'cost' => 12000000, 'acquired_on' => '2025-01-10',
        'opening_accumulated' => 1200000, 'opening_as_of' => '2026-01-01', 'useful_life_months' => 120,
    ], $this->key())->assertCreated();
    $rows = $this->asPerson($this->accountant)->getJson($this->api('fixed-assets/reconciliation?as_of=2026-01-01'))->json('data.rows');
    $accum = collect($rows)->firstWhere('kind', 'accumulated');

    expect($accum['register']['amount'])->toBe(1200000)->and($accum['opening_assets']['amount'])->toBe(1200000)
        ->and($accum['ledger']['amount'])->toBe(0)->and($accum['difference']['amount'])->toBe(1200000);
});

it('changes an estimate and records the old and new values in the audit trail', function (): void {
    $asset = $this->capitalisedAsset($this->category['id']);
    $updated = $this->asPerson($this->accountant)->putJson($this->api("fixed-assets/{$asset['id']}"), [
        'name' => 'Press', 'residual' => 1200000, 'method' => 'straight_line', 'useful_life_months' => 96, 'version' => $asset['version'],
    ], $this->key())->assertOk()->json('data');

    expect($updated['useful_life_months'])->toBe(96)->and($updated['residual']['amount'])->toBe(1200000)->and($updated['version'])->toBe($asset['version'] + 1);
    $event = adb('audit_events')->where('action', 'fixed_asset.updated')->first();
    $context = json_decode((string) $event->context, true);
    expect($context['change_of_estimate'])->toBe(['residual', 'useful_life_months'])->and($context['estimate_before']['useful_life_months'])->toBe(120);

    $this->asPerson($this->accountant)->putJson($this->api("fixed-assets/{$asset['id']}"), [
        'name' => 'Press', 'residual' => 99999999, 'method' => 'straight_line', 'useful_life_months' => 96, 'version' => $updated['version'],
    ], $this->key())->assertStatus(422)->assertJsonPath('code', 'asset_residual_invalid');
});

it('keeps the register equal to its movement log and the ledger consistent', function (): void {
    $this->capitalisedAsset($this->category['id']);
    $this->capitalisedAsset($this->category['id'], ['name' => 'Second'], 3000000, '2026-04-01');
    $sum = adb('asset_movements')->selectRaw('SUM(cost_delta) c, SUM(depreciation_delta) d')->first();

    expect((int) $sum->c)->toBe((int) adb('fixed_assets')->sum('cost'))->and((int) $sum->d)->toBe((int) adb('fixed_assets')->sum('accumulated_depreciation'))
        ->and((function () {
            adb('journals');

            return LedgerChecks::problems();
        })())->toBe([]);
});

it('refuses people without the permission and keeps movements append-only', function (): void {
    $this->asPerson($this->assistant)->postJson($this->api('asset-categories'), ['name' => 'X'], $this->key())->assertForbidden();
    $this->asPerson($this->assistant)->getJson($this->api('fixed-assets'))->assertForbidden();
    $asset = $this->capitalisedAsset($this->category['id']);
    $this->asPerson($this->approver)->putJson($this->api("fixed-assets/{$asset['id']}"), ['name' => 'X', 'method' => 'straight_line', 'useful_life_months' => 12, 'version' => 0], $this->key())->assertForbidden();

    expect(fn () => adb('asset_movements')->where('asset_id', $asset['id'])->update(['cost_delta' => 1]))->toThrow(QueryException::class);
});
