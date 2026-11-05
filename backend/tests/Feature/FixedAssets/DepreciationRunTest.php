<?php

declare(strict_types=1);

use Tests\Support\LedgerChecks;

/*
 * Plan 3c.14: depreciation runs. Worked example: 120,000.00 (12,000,000 minor units), 10 years, bought 20 March 2026: the
 * first charge is 1,000.00 (100,000) for March.
 */

beforeEach(function (): void {
    $this->setUpAssets();
    $this->category = $this->assetCategory();
    $this->asset = $this->capitalisedAsset($this->category['id']);
});

it('previews, then posts one journal: Dr depreciation expense 1,000.00, Cr accumulated depreciation 1,000.00 for March', function (): void {
    $preview = $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-03-15')))->assertOk()->json('data');
    expect($preview['total']['amount'])->toBe(100000)->and($preview['blockers'])->toBe([])->and($preview['lines'])->toHaveCount(1)
        ->and($preview['lines'][0])->toMatchArray(['asset_number' => 'FA-00001', 'months' => 1, 'catch_up_months' => 0])
        ->and($preview['lines'][0]['carrying_before']['amount'])->toBe(12000000)->and($preview['lines'][0]['carrying_after']['amount'])->toBe(11900000);

    $run = $this->postedRun('2026-03-15');

    expect($run['status'])->toBe('posted')->and($run['number'])->toBe('DEP-FY2026-00001')->and($run['total']['amount'])->toBe(100000)
        ->and($run['as_of'])->toBe('2026-03-31')->and($run['lines'])->toHaveCount(1)->and($run['lines'][0]['amount']['amount'])->toBe(100000)
        ->and($this->journalLines($run['journal_id']))->toBe([
            ['account' => '6500', 'debit' => 100000, 'credit' => 0],
            ['account' => '1510', 'debit' => 0, 'credit' => 100000],
        ]);
    $journal = $this->inTenant(fn () => adb('journals')->where('id', $run['journal_id'])->first());
    expect($journal->journal_type)->toBe('depreciation')->and($journal->source_type)->toBe('depreciation_run')->and($journal->source_id)->toBe($run['id'])
        ->and(substr((string) $journal->journal_date, 0, 10))->toBe('2026-03-31')->and($journal->status)->toBe('posted');

    $asset = $this->asPerson($this->accountant)->getJson($this->api("fixed-assets/{$this->asset['id']}"))->json('data');
    expect($asset['accumulated_depreciation']['amount'])->toBe(100000)->and($asset['carrying_amount']['amount'])->toBe(11900000)
        ->and($asset['months_charged'])->toBe(1)->and($asset['depreciated_through'])->toBe('2026-03-31');
    $m = adb('asset_movements')->where('asset_id', $this->asset['id'])->where('kind', 'depreciation')->get();
    expect($m)->toHaveCount(1)->and((int) $m[0]->depreciation_delta)->toBe(100000)->and($m[0]->journal_id)->toBe($run['journal_id']);
    expect((function () {
        adb('journals');

        return LedgerChecks::problems();
    })())->toBe([]);
});

it('runs a period only once unless the first run is reversed', function (): void {
    $this->postedRun('2026-03-15');
    $this->asPerson($this->accountant)->postJson($this->api('depreciation-runs'), ['period_id' => $this->periodId('2026-03-15')], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'depreciation_run_exists');
});

it('says there is nothing to depreciate when everything is up to date', function (): void {
    $this->postedRun('2026-03-15');
    $this->asPerson($this->accountant)->postJson($this->api('depreciation-runs'), ['period_id' => $this->periodId('2026-03-15')], $this->key())->assertStatus(422);
    $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-03-15')))
        ->assertOk()->assertJsonPath('data.blockers', ['depreciation_run_exists', 'nothing_to_depreciate']);
});

it('includes the missed months when earlier periods were skipped, and shows them in the preview', function (): void {
    // Another asset available from 10 January: by the March run it owes January, February and March.
    $this->capitalisedAsset($this->category['id'], ['name' => 'Lathe'], 6000000, '2026-01-10');
    $preview = $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-03-15')))->json('data');
    $lathe = collect($preview['lines'])->firstWhere('asset_name', 'Lathe');
    expect($lathe['months'])->toBe(3)->and($lathe['catch_up_months'])->toBe(2)->and($lathe['amount']['amount'])->toBe(150000)->and($preview['total']['amount'])->toBe(250000);

    $run = $this->postedRun('2026-03-15');
    expect($this->journalLines($run['journal_id']))->toBe([
        ['account' => '6500', 'debit' => 100000, 'credit' => 0], ['account' => '1510', 'debit' => 0, 'credit' => 100000],
        ['account' => '6500', 'debit' => 150000, 'credit' => 0], ['account' => '1510', 'debit' => 0, 'credit' => 150000],
    ]);
    expect(collect($run['lines'])->firstWhere('asset_name', 'Lathe'))->toMatchArray(['months' => 3, 'catch_up_months' => 2]);
});

it('goes through approval with maker not equal to checker', function (): void {
    $this->workflow('depreciation_run');
    $run = $this->draftRun('2026-03-15');
    $submitted = $this->asPerson($this->accountant, signing: true)->postJson($this->api("depreciation-runs/{$run['id']}/submit"), [], $this->key())->assertOk()->json('data');
    expect($submitted['status'])->toBe('pending_approval')->and($submitted['journal_id'])->toBeNull();

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("depreciation-runs/{$run['id']}/approve"), [], $this->key())->assertForbidden();
    $this->asPerson($this->approver)->postJson($this->api("depreciation-runs/{$run['id']}/approve"), [], $this->key())->assertForbidden()->assertJsonPath('code', 'signature_required');
    $posted = $this->asPerson($this->approver, signing: true)->postJson($this->api("depreciation-runs/{$run['id']}/approve"), [], $this->key())->assertOk()->json('data');

    expect($posted['status'])->toBe('posted')->and($posted['approved_by'])->not->toBe($posted['created_by'])->and($posted['journal_id'])->not->toBeNull();
    $signatures = adb('approval_requests')->where('document_type', 'depreciation_run')->where('document_id', $run['id'])->whereNotNull('signature_hash')->count();
    expect($signatures)->toBe(1);
});

it('refuses a closed period, at draft and at approval', function (): void {
    $this->workflow('depreciation_run');
    $draft = $this->draftRun('2026-03-15');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("depreciation-runs/{$draft['id']}/submit"), [], $this->key())->assertOk();
    $this->inTenant(fn () => adb('fiscal_periods')->where('id', $this->periodId('2026-03-15'))->update(['status' => 'closed']));

    $this->asPerson($this->approver, signing: true)->postJson($this->api("depreciation-runs/{$draft['id']}/approve"), [], $this->key())
        ->assertStatus(422);
    expect(adb('depreciation_runs')->where('id', $draft['id'])->value('status'))->toBe('pending_approval')->and(adb('journals')->where('journal_type', 'depreciation')->count())->toBe(0);

    $this->asPerson($this->accountant)->postJson($this->api('depreciation-runs'), ['period_id' => $this->periodId('2026-03-15')], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'period_closed');
});

it('adds a close checklist item: depreciation run done or nothing to depreciate', function (): void {
    $check = fn () => $this->asPerson($this->owner)->getJson($this->api('fiscal-periods/'.$this->periodId('2026-03-15').'/close-checks'));
    $response = $check();
    $response->assertOk();
    $items = collect($response->json('data'));
    $depr = $items->firstWhere('code', 'DEPR_RUN');
    expect($depr['passed'])->toBeFalse()->and($depr['message'])->toContain('need depreciation');

    $this->postedRun('2026-03-15');
    expect(collect($check()->json('data'))->firstWhere('code', 'DEPR_RUN')['passed'])->toBeTrue();

    // February: the asset was not bought yet, so nothing is due.
    expect(collect($this->asPerson($this->owner)->getJson($this->api('fiscal-periods/'.$this->periodId('2026-02-10').'/close-checks'))->json('data'))->firstWhere('code', 'DEPR_RUN'))
        ->toMatchArray(['passed' => true, 'message' => 'No asset needs depreciating.']);
});

it('never depreciates land', function (): void {
    $land = $this->assetCategory(['name' => 'Land', 'asset_account_id' => $this->f->account('1520'), 'accumulated_account_id' => $this->f->account('1530'), 'is_depreciable' => false, 'default_life_months' => null]);
    [, $line] = $this->assetPurchaseJournal(50000000, '2026-03-02', '1520');
    $this->asPerson($this->accountant)->postJson($this->api('fixed-assets'), ['name' => 'Plot', 'category_id' => $land['id'], 'source_type' => 'journal_line', 'source_id' => $line], $this->key())->assertCreated();

    $preview = $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-03-15')))->json('data');
    expect($preview['lines'])->toHaveCount(1)->and($preview['total']['amount'])->toBe(100000);
});

it('depreciates by units: asks for them, then charges the share of the units used', function (): void {
    $uop = $this->assetCategory(['name' => 'Machines', 'default_method' => 'units_of_production']);
    $asset = $this->capitalisedAsset($uop['id'], ['name' => 'Press', 'method' => 'units_of_production', 'units_total' => 100000, 'residual' => 2000000, 'useful_life_months' => null], 12000000, '2026-03-05');

    $preview = $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-03-15')))->json('data');
    expect($preview['blockers'])->toContain('units_required')->and($preview['pending_units'][0]['asset_id'])->toBe($asset['id']);
    $this->asPerson($this->accountant)->postJson($this->api('depreciation-runs'), ['period_id' => $this->periodId('2026-03-15')], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'units_required');

    // (12,000,000 - 2,000,000) x 5,000 / 100,000 = 500,000, plus the first asset's 100,000.
    $run = $this->postedRun('2026-03-15', [$asset['id'] => 5000]);
    expect($run['total']['amount'])->toBe(600000)->and(collect($run['lines'])->firstWhere('asset_id', $asset['id'])['units'])->toBe(5000);
    $after = $this->asPerson($this->accountant)->getJson($this->api("fixed-assets/{$asset['id']}"))->json('data');
    expect($after['units_used'])->toBe(5000)->and($after['accumulated_depreciation']['amount'])->toBe(500000);
});

it('puts the asset\'s dimensions on its depreciation lines', function (): void {
    $dim = $this->asPerson($this->owner, signing: true)->postJson($this->api('dimensions'), ['code' => 'DEPT', 'name' => 'Department'], $this->key())->assertCreated()->json('data.id');
    $value = $this->asPerson($this->owner, signing: true)->postJson($this->api("dimensions/{$dim}/values"), ['code' => 'OPS', 'name' => 'Operations'], $this->key())->assertCreated()->json('data.id');
    $asset = $this->capitalisedAsset($this->category['id'], ['name' => 'Packer', 'dimensions' => [$dim => $value]], 1200000, '2026-03-03');
    expect($asset['dimensions'])->not->toBe([]);

    $run = $this->postedRun('2026-03-15');
    $tagged = adb('journal_lines')->where('journal_id', $run['journal_id'])->whereNotNull('dim1_value_id')->count();
    expect($tagged)->toBe(2);
});

it('reverses a run: the journal is mirrored, the register goes back, and the period can be run again', function (): void {
    $run = $this->postedRun('2026-03-15');
    $reversed = $this->asPerson($this->owner, signing: true)->postJson($this->api("depreciation-runs/{$run['id']}/reverse"), [], $this->key())->assertOk()->json('data');

    expect($reversed['status'])->toBe('reversed')->and($reversed['reversal_journal_id'])->not->toBeNull()
        ->and($this->journalLines($reversed['reversal_journal_id']))->toBe([
            ['account' => '6500', 'debit' => 0, 'credit' => 100000],
            ['account' => '1510', 'debit' => 100000, 'credit' => 0],
        ]);
    $asset = $this->asPerson($this->accountant)->getJson($this->api("fixed-assets/{$this->asset['id']}"))->json('data');
    expect($asset['accumulated_depreciation']['amount'])->toBe(0)->and($asset['months_charged'])->toBe(0)->and($asset['depreciated_through'])->toBeNull();
    expect(adb('asset_movements')->where('asset_id', $this->asset['id'])->pluck('kind')->all())->toBe(['addition', 'depreciation', 'reversal']);

    $again = $this->postedRun('2026-03-15');
    expect($again['status'])->toBe('posted')->and($again['number'])->toBe('DEP-FY2026-00002');
    expect((function () {
        adb('journals');

        return LedgerChecks::problems();
    })())->toBe([]);
});

it('does not reverse a run while a later run stands on the same assets', function (): void {
    $march = $this->postedRun('2026-03-15');
    $this->postedRun('2026-04-15');
    $this->asPerson($this->owner, signing: true)->postJson($this->api("depreciation-runs/{$march['id']}/reverse"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'reversal_blocked_by_later_activity');
});

it('refuses to post a run whose figures went stale because an estimate changed after drafting', function (): void {
    $this->workflow('depreciation_run');
    $run = $this->draftRun('2026-03-15');
    $this->asPerson($this->accountant)->putJson($this->api("fixed-assets/{$this->asset['id']}"), [
        'name' => 'Press', 'method' => 'straight_line', 'useful_life_months' => 60, 'version' => $this->asset['version'],
    ], $this->key())->assertOk();

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("depreciation-runs/{$run['id']}/submit"), [], $this->key())
        ->assertStatus(422);
    expect(adb('depreciation_runs')->where('id', $run['id'])->value('status'))->toBe('draft');
});

it('applies a change of estimate going forward only: April uses the new life, March stays as posted', function (): void {
    $this->postedRun('2026-03-15');
    $this->asPerson($this->accountant)->putJson($this->api("fixed-assets/{$this->asset['id']}"), [
        'name' => 'Press', 'method' => 'straight_line', 'useful_life_months' => 60, 'version' => $this->asset['version'] + 1,
    ], $this->key())->assertOk();

    $preview = $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-04-15')))->json('data');
    // Carrying 11,900,000 over the 59 months left of a 60-month life = 201,694.9 -> 201,695.
    expect($preview['lines'][0]['amount']['amount'])->toBe(201695);
    $march = adb('asset_movements')->where('asset_id', $this->asset['id'])->where('kind', 'depreciation')->first();
    expect((int) $march->depreciation_delta)->toBe(100000);
});

it('needs the right permissions', function (): void {
    $this->asPerson($this->assistant)->postJson($this->api('depreciation-runs'), ['period_id' => $this->periodId('2026-03-15')], $this->key())->assertForbidden();
    $this->asPerson($this->approver)->postJson($this->api('depreciation-runs'), ['period_id' => $this->periodId('2026-03-15')], $this->key())->assertForbidden();
    $this->asPerson($this->assistant)->getJson($this->api('depreciation-runs'))->assertForbidden();
});
