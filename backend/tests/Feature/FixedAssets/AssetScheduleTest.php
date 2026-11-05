<?php

declare(strict_types=1);

/*
 * Plan 3c.15: the asset schedule ties to the ledger. Press 120,000.00 from 10 January and Lathe 30,000.00 from 1 February (both 10 years),
 * depreciated January to April, Lathe disposed of in May for 28,000.00.
 */

beforeEach(function (): void {
    $this->setUpAssets();
    $this->category = $this->assetCategory();
    $this->press = $this->capitalisedAsset($this->category['id'], ['name' => 'Press'], 12000000, '2026-01-10');
    $this->lathe = $this->capitalisedAsset($this->category['id'], ['name' => 'Lathe'], 3000000, '2026-02-01');
    foreach (['01', '02', '03', '04'] as $m) {
        $this->postedRun("2026-{$m}-15");
    }
    $draft = $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
        'kind' => 'disposal', 'tx_date' => '2026-05-15', 'asset_id' => $this->lathe['id'], 'proceeds' => 2800000, 'proceeds_account_id' => $this->f->account('1000'),
    ], $this->key())->assertCreated()->json('data');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("asset-transactions/{$draft['id']}/submit"), [], $this->key())->assertOk();
    $this->schedule = fn (string $from, string $to) => $this->asPerson($this->accountant)->getJson($this->api("reports/asset-schedule?from={$from}&to={$to}"))->assertOk()->json('data');
});

it('shows opening cost, additions, disposals and closing cost, then accumulated charge, disposals and carrying amount', function (): void {
    $r = ($this->schedule)('2026-01-01', '2026-06-30');
    $c = $r['categories'][0];

    expect($c['category_name'])->toBe('Equipment')
        ->and($c['cost'])->toMatchArray(['opening' => ['amount' => 0, 'currency' => 'USD'], 'additions' => ['amount' => 15000000, 'currency' => 'USD'], 'disposals' => ['amount' => -3000000, 'currency' => 'USD'], 'closing' => ['amount' => 12000000, 'currency' => 'USD']])
        // Press 4 x 100,000 = 400,000; Lathe 3 x 25,000 = 75,000 (February, March, April).
        ->and($c['accumulated']['charge']['amount'])->toBe(475000)->and($c['accumulated']['disposals']['amount'])->toBe(-75000)->and($c['accumulated']['closing']['amount'])->toBe(400000)
        ->and($c['carrying_opening']['amount'])->toBe(0)->and($c['carrying_closing']['amount'])->toBe(11600000)
        ->and($c['assets'])->toHaveCount(2)->and($r['totals']['cost']['closing']['amount'])->toBe(12000000);
});

it('ties to the ledger: the closing figures equal the trial balance of the asset and accumulated accounts', function (): void {
    $r = ($this->schedule)('2026-01-01', '2026-06-30');
    $tb = collect($this->asPerson($this->accountant)->getJson($this->api('reports/trial-balance?as_of=2026-06-30'))->assertOk()->json('data.rows'));
    $cost = $tb->firstWhere('account.code', '1500');
    $accum = $tb->firstWhere('account.code', '1510');

    expect($r['ties_to_ledger'])->toBeTrue()
        ->and($cost['debit']['amount'])->toBe($r['totals']['cost']['closing']['amount'])
        ->and($accum['credit']['amount'])->toBe($r['totals']['accumulated']['closing']['amount']);
});

it('rolls forward from a later start: opening is what the earlier months left, and opening plus movements is closing', function (): void {
    $r = ($this->schedule)('2026-03-01', '2026-06-30');
    $t = $r['totals'];

    // To the end of February: cost 15,000,000; accumulated Press 200,000 + Lathe 25,000.
    expect($t['cost']['opening']['amount'])->toBe(15000000)->and($t['accumulated']['opening']['amount'])->toBe(225000)->and($t['carrying_opening']['amount'])->toBe(14775000)
        ->and($t['accumulated']['charge']['amount'])->toBe(250000)->and($t['accumulated']['disposals']['amount'])->toBe(-75000);
    $sum = fn (array $block, array $keys) => array_sum(array_map(fn ($k) => $block[$k]['amount'], $keys));
    expect($sum($t['cost'], ['opening', 'additions', 'opening_assets', 'disposals', 'revaluation']))->toBe($t['cost']['closing']['amount'])
        ->and($sum($t['accumulated'], ['opening', 'opening_assets', 'charge', 'impairment', 'disposals', 'revaluation']))->toBe($t['accumulated']['closing']['amount']);
});

it('lists the movements with their journals so each can be drilled into', function (): void {
    $r = ($this->schedule)('2026-05-01', '2026-05-31');

    expect($r['events'])->toHaveCount(1)->and($r['events'][0])->toMatchArray(['kind' => 'disposal', 'asset_number' => 'FA-00002', 'date' => '2026-05-15'])
        ->and($r['events'][0]['journal_id'])->not->toBeNull()->and($r['events'][0]['journal_number'])->not->toBeNull();
    $this->asPerson($this->accountant)->getJson($this->api("journals/{$r['events'][0]['journal_id']}"))->assertOk();
});

it('shows a reversed disposal in the disposal column, netted to nothing', function (): void {
    $id = adb('asset_transactions')->value('id');
    $this->asPerson($this->owner, signing: true)->postJson($this->api("asset-transactions/{$id}/reverse"), [], $this->key())->assertOk();
    $r = ($this->schedule)('2026-01-01', '2026-06-30');

    expect($r['totals']['cost']['disposals']['amount'])->toBe(0)->and($r['totals']['cost']['closing']['amount'])->toBe(15000000)
        ->and($r['ties_to_ledger'])->toBeTrue();
});

it('exports through the existing report export path', function (): void {
    $response = $this->asPerson($this->accountant)->get($this->api('reports/asset-schedule/export?format=csv&from=2026-01-01&to=2026-06-30'))->assertOk();
    $csv = $response->streamedContent();

    expect($csv)->toContain('Total Equipment')->and($csv)->toContain('FA-00001 Press')->and($csv)->toContain('120000.00');
});

it('needs reports.view', function (): void {
    $this->asPerson($this->assistant)->getJson($this->api('reports/asset-schedule?from=2026-01-01&to=2026-06-30'))->assertForbidden();
});
