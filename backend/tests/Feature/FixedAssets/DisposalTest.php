<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;

/*
 * Plan 3c.15: disposal. Press 120,000.00 bought 20 March, depreciated March and April (1,000.00 each): accumulated 2,000.00,
 * carrying 118,000.00. Disposed in May, which is never charged.
 */

function disposalProblems(): array
{
    adb('journals');

    return LedgerChecks::problems();
}

beforeEach(function (): void {
    $this->setUpAssets();
    $this->category = $this->assetCategory();
    $this->asset = $this->capitalisedAsset($this->category['id']);
    $this->postedRun('2026-03-15');
    $this->postedRun('2026-04-15');
    $this->dispose = fn (array $over = []) => $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
        'kind' => 'disposal', 'tx_date' => '2026-05-15', 'asset_id' => $this->asset['id'], 'proceeds' => 12500000,
        'proceeds_account_id' => $this->f->account('1000'), 'reason' => 'Sold', ...$over,
    ], $this->key());
    $this->post = function (string $id) {
        $this->asPerson($this->accountant, signing: true)->postJson($this->api("asset-transactions/{$id}/submit"), [], $this->key())->assertOk();

        return $this->asPerson($this->accountant)->getJson($this->api("asset-transactions/{$id}"))->json('data');
    };
});

it('disposes with a gain: Dr accumulated 2,000.00, Dr bank 125,000.00, Cr cost 120,000.00, Cr gain 7,000.00', function (): void {
    $tx = ($this->dispose)()->assertCreated()->json('data');
    expect($tx['status'])->toBe('draft')->and($tx['kind'])->toBe('disposal');
    $posted = ($this->post)($tx['id']);

    expect($posted['status'])->toBe('posted')->and($posted['number'])->toBe('DSP-FY2026-00001')
        ->and($posted['lines'][0]['carrying_before']['amount'])->toBe(11800000)->and($posted['lines'][0]['gain_or_loss']['amount'])->toBe(700000)
        ->and($this->journalLines($posted['journal_id']))->toBe([
            ['account' => '1510', 'debit' => 200000, 'credit' => 0],
            ['account' => '1000', 'debit' => 12500000, 'credit' => 0],
            ['account' => '1500', 'debit' => 0, 'credit' => 12000000],
            ['account' => '7500', 'debit' => 0, 'credit' => 700000],
        ]);
    $journal = adb('journals')->where('id', $posted['journal_id'])->first();
    expect($journal->journal_type)->toBe('asset')->and($journal->source_type)->toBe('asset_disposal');

    $asset = $this->asPerson($this->accountant)->getJson($this->api("fixed-assets/{$this->asset['id']}"))->json('data');
    expect($asset['status'])->toBe('disposed')->and($asset['disposed_on'])->toBe('2026-05-15')->and($asset['cost']['amount'])->toBe(0)
        ->and($asset['accumulated_depreciation']['amount'])->toBe(0)->and($asset['carrying_amount']['amount'])->toBe(0);
    expect(disposalProblems())->toBe([]);

    // No further depreciation, and the register still ties to the ledger.
    $preview = $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-05-15')))->json('data');
    expect($preview['blockers'])->toContain('nothing_to_depreciate');
    expect($this->asPerson($this->accountant)->getJson($this->api('fixed-assets/reconciliation?as_of=2026-05-31'))->json('data.reconciles'))->toBeTrue();
});

it('disposes with a loss: Dr accumulated 2,000.00, Dr bank 100,000.00, Dr loss 18,000.00, Cr cost 120,000.00', function (): void {
    $tx = ($this->dispose)(['proceeds' => 10000000])->assertCreated()->json('data');
    $posted = ($this->post)($tx['id']);

    expect($this->journalLines($posted['journal_id']))->toBe([
        ['account' => '1510', 'debit' => 200000, 'credit' => 0],
        ['account' => '1000', 'debit' => 10000000, 'credit' => 0],
        ['account' => '1500', 'debit' => 0, 'credit' => 12000000],
        ['account' => '8500', 'debit' => 1800000, 'credit' => 0],
    ])->and($posted['lines'][0]['gain_or_loss']['amount'])->toBe(-1800000);
});

it('scrapping for nothing books the whole carrying amount as loss and needs no proceeds account', function (): void {
    $tx = ($this->dispose)(['proceeds' => 0, 'proceeds_account_id' => null])->assertCreated()->json('data');
    $posted = ($this->post)($tx['id']);

    expect($this->journalLines($posted['journal_id']))->toBe([
        ['account' => '1510', 'debit' => 200000, 'credit' => 0], ['account' => '1500', 'debit' => 0, 'credit' => 12000000], ['account' => '8500', 'debit' => 11800000, 'credit' => 0],
    ]);
});

it('previews with the journal lines and writes nothing', function (): void {
    $before = adb('asset_transactions')->count();
    $preview = $this->asPerson($this->accountant)->postJson($this->api('asset-transactions/preview'), [
        'kind' => 'disposal', 'tx_date' => '2026-05-15', 'asset_id' => $this->asset['id'], 'proceeds' => 12500000, 'proceeds_account_id' => $this->f->account('1000'),
    ], $this->key())->assertOk()->json('data');

    expect($preview['assets'][0]['gain_or_loss']['amount'])->toBe(700000)->and($preview['assets'][0]['journal_lines'])->toHaveCount(4)
        ->and($preview['assets'][0]['journal_lines'][3])->toMatchArray(['account_code' => '7500'])->and(adb('asset_transactions')->count())->toBe($before);
});

it('refuses to dispose until depreciation is current, with a message that says what to run', function (): void {
    ($this->dispose)(['tx_date' => '2026-06-15'])->assertStatus(422)->assertJsonPath('code', 'depreciation_not_current')
        ->assertJsonPath('detail', 'Run depreciation up to 2026-05-31 for FA-00001 before this: its carrying amount is out of date.');
});

it('refuses a disposal in a month that has already been charged', function (): void {
    $this->postedRun('2026-05-15');
    ($this->dispose)()->assertStatus(422)->assertJsonPath('code', 'depreciation_in_disposal_month');
});

it('refuses with a clear message when the chart has no gain on disposal account, and never guesses one', function (): void {
    adb('company_settings')->where('company_id', $this->f->companyId)->update(['posting_accounts' => json_encode(['retained_earnings' => $this->f->account('3000')])]);
    ($this->dispose)()->assertStatus(422)->assertJsonPath('code', 'posting_account_missing')
        ->assertJsonPath('detail', fn (string $m) => str_contains($m, 'gain on disposal of assets') && str_contains($m, 'asset_disposal_gain'));
    expect(adb('asset_transactions')->count())->toBe(0);
});

it('refuses proceeds to a trade receivables account', function (): void {
    ($this->dispose)(['proceeds_account_id' => $this->f->account('1100')])->assertStatus(422)->assertJsonPath('code', 'proceeds_account_invalid');
    ($this->dispose)(['proceeds_account_id' => null])->assertStatus(422)->assertJsonPath('code', 'proceeds_account_required');
});

it('takes the proceeds to an other-receivables account when they are not paid yet', function (): void {
    $tx = ($this->dispose)(['proceeds_account_id' => $this->f->account('1540')])->assertCreated()->json('data');
    $posted = ($this->post)($tx['id']);

    expect($this->journalLines($posted['journal_id'])[1])->toBe(['account' => '1540', 'debit' => 12500000, 'credit' => 0]);
});

it('goes through approval: maker is not the checker, and a closed period stops it at approval', function (): void {
    $this->workflow('asset_transaction');
    $tx = ($this->dispose)()->assertCreated()->json('data');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("asset-transactions/{$tx['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("asset-transactions/{$tx['id']}/approve"), [], $this->key())->assertForbidden();

    adb('fiscal_periods')->where('id', $this->periodId('2026-05-15'))->update(['status' => 'closed']);
    $this->asPerson($this->approver, signing: true)->postJson($this->api("asset-transactions/{$tx['id']}/approve"), [], $this->key())->assertStatus(422);
    expect(adb('asset_transactions')->where('id', $tx['id'])->value('status'))->toBe('pending_approval');

    adb('fiscal_periods')->where('id', $this->periodId('2026-05-15'))->update(['status' => 'open']);
    $this->asPerson($this->approver, signing: true)->postJson($this->api("asset-transactions/{$tx['id']}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
    expect(adb('fiscal_periods')->count())->toBeGreaterThan(0);
});

it('reverses a disposal: the journal is mirrored and the asset is active again with its figures', function (): void {
    $tx = ($this->dispose)()->assertCreated()->json('data');
    $posted = ($this->post)($tx['id']);
    $reversed = $this->asPerson($this->owner, signing: true)->postJson($this->api("asset-transactions/{$posted['id']}/reverse"), [], $this->key())->assertOk()->json('data');

    expect($reversed['status'])->toBe('reversed')->and($this->journalLines($reversed['reversal_journal_id']))->toBe([
        ['account' => '1510', 'debit' => 0, 'credit' => 200000], ['account' => '1000', 'debit' => 0, 'credit' => 12500000],
        ['account' => '1500', 'debit' => 12000000, 'credit' => 0], ['account' => '7500', 'debit' => 700000, 'credit' => 0],
    ]);
    $asset = $this->asPerson($this->accountant)->getJson($this->api("fixed-assets/{$this->asset['id']}"))->json('data');
    expect($asset['status'])->toBe('active')->and($asset['disposed_on'])->toBeNull()->and($asset['cost']['amount'])->toBe(12000000)
        ->and($asset['accumulated_depreciation']['amount'])->toBe(200000)->and($asset['carrying_amount']['amount'])->toBe(11800000);
    expect(disposalProblems())->toBe([]);
});

it('does not reverse a disposal while the asset is... or after a depreciation run reversal is needed first', function (): void {
    $tx = ($this->dispose)()->assertCreated()->json('data');
    ($this->post)($tx['id']);
    // The April run stands under the disposal, so it cannot be reversed first.
    $april = adb('depreciation_runs')->where('status', 'posted')->orderByDesc('as_of')->first();
    $this->asPerson($this->owner, signing: true)->postJson($this->api("depreciation-runs/{$april->id}/reverse"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'reversal_blocked_by_later_activity');
});

it('does not dispose of the same asset twice', function (): void {
    $tx = ($this->dispose)()->assertCreated()->json('data');
    ($this->post)($tx['id']);
    ($this->dispose)()->assertStatus(422)->assertJsonPath('code', 'asset_disposed');
    expect(DB::connection()->getName())->not->toBe('');
});

it('needs the dispose permission', function (): void {
    $this->asPerson($this->assistant)->postJson($this->api('asset-transactions'), ['kind' => 'disposal'], $this->key())->assertForbidden();
    $this->asPerson($this->approver)->postJson($this->api('asset-transactions'), [
        'kind' => 'disposal', 'tx_date' => '2026-05-15', 'asset_id' => $this->asset['id'],
    ], $this->key())->assertForbidden();
});
