<?php

declare(strict_types=1);

use Tests\Support\LedgerChecks;

/*
 * Plan 3c.15a: impairment and its reversal (IAS 36), and the revaluation of a whole category (IAS 16.31-42). Amounts are minor units.
 */

function revalProblems(): array
{
    adb('journals');

    return LedgerChecks::problems();
}

beforeEach(function (): void {
    $this->setUpAssets();
    $this->txn = function (array $body, bool $post = true) {
        $tx = $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), $body, $this->key())->assertCreated()->json('data');
        if (! $post) {
            return $tx;
        }
        $this->asPerson($this->accountant, signing: true)->postJson($this->api("asset-transactions/{$tx['id']}/submit"), [], $this->key())->assertOk();

        return $this->asPerson($this->accountant)->getJson($this->api("asset-transactions/{$tx['id']}"))->json('data');
    };
    $this->asset = fn (string $id) => $this->asPerson($this->accountant)->getJson($this->api("fixed-assets/{$id}"))->json('data');
});

describe('impairment', function (): void {
    beforeEach(function (): void {
        $this->category = $this->assetCategory();
        $this->press = $this->capitalisedAsset($this->category['id']);
        $this->postedRun('2026-03-15');
        $this->postedRun('2026-04-15');
    });

    it('impairs through profit or loss: Dr impairment loss 15,000.00, Cr accumulated 15,000.00', function (): void {
        $tx = ($this->txn)(['kind' => 'impairment', 'tx_date' => '2026-05-15', 'asset_id' => $this->press['id'], 'amount' => 1500000, 'reason' => 'Fire damage']);

        expect($tx['status'])->toBe('posted')->and($tx['number'])->toBe('IMP-FY2026-00001')
            ->and($this->journalLines($tx['journal_id']))->toBe([['account' => '8600', 'debit' => 1500000, 'credit' => 0], ['account' => '1510', 'debit' => 0, 'credit' => 1500000]]);
        $a = ($this->asset)($this->press['id']);
        expect($a['accumulated_impairment']['amount'])->toBe(1500000)->and($a['carrying_amount']['amount'])->toBe(10300000);
        $j = adb('journals')->where('id', $tx['journal_id'])->first();
        expect($j->source_type)->toBe('asset_impairment')->and($j->journal_type)->toBe('asset');
        expect(revalProblems())->toBe([]);
    });

    it('depreciates the new carrying amount over the remaining life, from the next run', function (): void {
        ($this->txn)(['kind' => 'impairment', 'tx_date' => '2026-05-15', 'asset_id' => $this->press['id'], 'amount' => 1500000, 'reason' => 'Fire damage']);
        $preview = $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-05-15')))->json('data');

        // 10,300,000 over the 118 months left = 87,288.14 -> 87,288 (without the impairment it would be 100,000).
        expect($preview['lines'][0]['amount']['amount'])->toBe(87288);
    });

    it('reverses an impairment only up to what depreciation alone would have left (IAS 36.117)', function (): void {
        ($this->txn)(['kind' => 'impairment', 'tx_date' => '2026-05-15', 'asset_id' => $this->press['id'], 'amount' => 1500000, 'reason' => 'Fire damage']);
        $this->postedRun('2026-05-15');
        // May: carrying 10,300,000 - 87,288 = 10,212,712; the path without impairment: 11,800,000 - 100,000 = 11,700,000. Cap 1,487,288.
        $body = ['kind' => 'impairment_reversal', 'tx_date' => '2026-06-10', 'asset_id' => $this->press['id'], 'reason' => 'Repaired'];
        $preview = $this->asPerson($this->accountant)->postJson($this->api('asset-transactions/preview'), $body + ['amount' => 1000000], $this->key())->assertOk()->json('data');
        expect($preview['assets'][0]['cap']['amount'])->toBe(1487288);

        $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), $body + ['amount' => 1487289], $this->key())
            ->assertStatus(422)->assertJsonPath('code', 'reversal_exceeds_cap');
        $this->postedRun('2026-06-15');
        // June: the path moves on, so the cap is checked again from the run just made.
        $tx = ($this->txn)($body + ['amount' => 1000000, 'tx_date' => '2026-07-10']);
        expect($this->journalLines($tx['journal_id']))->toBe([['account' => '1510', 'debit' => 1000000, 'credit' => 0], ['account' => '7600', 'debit' => 0, 'credit' => 1000000]]);
        expect(revalProblems())->toBe([]);
    });

    it('refuses a reversal when nothing was impaired', function (): void {
        $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
            'kind' => 'impairment_reversal', 'tx_date' => '2026-05-15', 'asset_id' => $this->press['id'], 'amount' => 1, 'reason' => 'x',
        ], $this->key())->assertStatus(422)->assertJsonPath('code', 'reversal_exceeds_cap');
    });

    it('refuses an impairment that would take the carrying amount below the residual value, and one with no reason', function (): void {
        $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
            'kind' => 'impairment', 'tx_date' => '2026-05-15', 'asset_id' => $this->press['id'], 'amount' => 11800001, 'reason' => 'x',
        ], $this->key())->assertStatus(422)->assertJsonPath('code', 'impairment_below_residual');
        $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
            'kind' => 'impairment', 'tx_date' => '2026-05-15', 'asset_id' => $this->press['id'], 'amount' => 100,
        ], $this->key())->assertStatus(422)->assertJsonPath('code', 'reason_required');
    });

    it('takes an impairment back out of the register when it is reversed as a document', function (): void {
        $tx = ($this->txn)(['kind' => 'impairment', 'tx_date' => '2026-05-15', 'asset_id' => $this->press['id'], 'amount' => 1500000, 'reason' => 'Fire damage']);
        $this->asPerson($this->owner, signing: true)->postJson($this->api("asset-transactions/{$tx['id']}/reverse"), [], $this->key())->assertOk();
        $a = ($this->asset)($this->press['id']);

        expect($a['accumulated_impairment']['amount'])->toBe(0)->and($a['carrying_amount']['amount'])->toBe(11800000);
        expect(revalProblems())->toBe([]);
    });
});

describe('revaluation', function (): void {
    beforeEach(function (): void {
        $this->cat = $this->assetCategory(['name' => 'Buildings', 'measurement_model' => 'revaluation']);
        $this->a = $this->capitalisedAsset($this->cat['id'], ['name' => 'Block A'], 10000000, '2026-03-01');
        $this->b = $this->capitalisedAsset($this->cat['id'], ['name' => 'Block B'], 6000000, '2026-03-01');
        $this->postedRun('2026-03-15');
        $this->postedRun('2026-04-15');
        $this->reval = fn (array $values, string $date, bool $post = true) => ($this->txn)([
            'kind' => 'revaluation', 'tx_date' => $date, 'category_id' => $this->cat['id'], 'reason' => 'Annual valuation',
            'values' => collect($values)->map(fn ($v, $id) => ['asset_id' => $id, 'value' => $v])->values()->all(),
        ], $post);
    });

    it('revalues the whole category at once: up to the reserve, down to profit or loss, accumulated depreciation eliminated', function (): void {
        // A: cost 10,000,000, accumulated 166,666 (carrying 9,833,334) to 11,000,000. B: cost 6,000,000, accumulated 100,000 (5,900,000) to 5,000,000.
        $tx = ($this->reval)([$this->a['id'] => 11000000, $this->b['id'] => 5000000], '2026-05-15');

        expect($tx['status'])->toBe('posted')->and($tx['number'])->toBe('REV-FY2026-00001')->and($this->journalLines($tx['journal_id']))->toBe([
            ['account' => '1510', 'debit' => 166666, 'credit' => 0], ['account' => '1500', 'debit' => 1000000, 'credit' => 0], ['account' => '3300', 'debit' => 0, 'credit' => 1166666],
            ['account' => '1510', 'debit' => 100000, 'credit' => 0], ['account' => '1500', 'debit' => 0, 'credit' => 1000000], ['account' => '8600', 'debit' => 900000, 'credit' => 0],
        ]);
        $a = ($this->asset)($this->a['id']);
        $b = ($this->asset)($this->b['id']);
        expect($a['cost']['amount'])->toBe(11000000)->and($a['accumulated_depreciation']['amount'])->toBe(0)->and($a['revaluation_reserve']['amount'])->toBe(1166666)
            ->and($b['cost']['amount'])->toBe(5000000)->and($b['revaluation_reserve']['amount'])->toBe(0);
        expect(adb('journals')->where('id', $tx['journal_id'])->value('source_type'))->toBe('asset_revaluation');
        expect(revalProblems())->toBe([]);
    });

    it('then depreciates the revalued amount going forward', function (): void {
        ($this->reval)([$this->a['id'] => 11000000, $this->b['id'] => 5000000], '2026-05-15');
        $preview = $this->asPerson($this->accountant)->getJson($this->api('depreciation-runs/preview?period_id='.$this->periodId('2026-05-15')))->json('data');
        $byName = collect($preview['lines'])->keyBy('asset_name');

        // 11,000,000 / 118 = 93,220.34; 5,000,000 / 118 = 42,372.88.
        expect($byName['Block A']['amount']['amount'])->toBe(93220)->and($byName['Block B']['amount']['amount'])->toBe(42373);
    });

    it('a decrease uses that asset\'s own reserve first; an increase first reverses its earlier loss in profit or loss', function (): void {
        ($this->reval)([$this->a['id'] => 11000000, $this->b['id'] => 5000000], '2026-05-15');
        $this->postedRun('2026-05-15');
        // A: carrying 11,000,000 - 93,220 = 10,906,780, to 10,500,000: a decrease of 406,780, all taken from A's reserve of 1,166,666.
        // B: carrying 5,000,000 - 42,373 = 4,957,627, to 5,200,000: an increase of 242,373, all reversing the 900,000 loss in profit or loss.
        $tx = ($this->reval)([$this->a['id'] => 10500000, $this->b['id'] => 5200000], '2026-06-15');

        expect($this->journalLines($tx['journal_id']))->toBe([
            ['account' => '1510', 'debit' => 93220, 'credit' => 0], ['account' => '1500', 'debit' => 0, 'credit' => 500000], ['account' => '3300', 'debit' => 406780, 'credit' => 0],
            ['account' => '1510', 'debit' => 42373, 'credit' => 0], ['account' => '1500', 'debit' => 200000, 'credit' => 0], ['account' => '7600', 'debit' => 0, 'credit' => 242373],
        ]);
        $a = ($this->asset)($this->a['id']);
        $b = ($this->asset)($this->b['id']);
        expect($a['revaluation_reserve']['amount'])->toBe(1166666 - 406780)->and($b['revaluation_reserve']['amount'])->toBe(0);
        expect(revalProblems())->toBe([]);
    });

    it('covers every asset in the category and only a revalued category', function (): void {
        $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
            'kind' => 'revaluation', 'tx_date' => '2026-05-15', 'category_id' => $this->cat['id'], 'reason' => 'x', 'values' => [['asset_id' => $this->a['id'], 'value' => 11000000]],
        ], $this->key())->assertStatus(422)->assertJsonPath('code', 'revaluation_incomplete');

        $cost = $this->assetCategory(['name' => 'Equipment']);
        $press = $this->capitalisedAsset($cost['id'], ['name' => 'Press'], 12000000, '2026-03-20');
        $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
            'kind' => 'revaluation', 'tx_date' => '2026-05-15', 'category_id' => $cost['id'], 'reason' => 'x', 'values' => [['asset_id' => $press['id'], 'value' => 1]],
        ], $this->key())->assertStatus(422)->assertJsonPath('code', 'category_not_revalued');
    });

    it('previews the whole category with the split between reserve and profit or loss', function (): void {
        $preview = $this->asPerson($this->accountant)->postJson($this->api('asset-transactions/preview'), [
            'kind' => 'revaluation', 'tx_date' => '2026-05-15', 'category_id' => $this->cat['id'], 'reason' => 'x',
            'values' => [['asset_id' => $this->a['id'], 'value' => 11000000], ['asset_id' => $this->b['id'], 'value' => 5000000]],
        ], $this->key())->assertOk()->json('data');

        expect($preview['assets'])->toHaveCount(2)->and($preview['assets'][0]['to_reserve']['amount'])->toBe(1166666)->and($preview['assets'][1]['to_profit_or_loss']['amount'])->toBe(900000);
    });

    it('impairs a revalued asset against its reserve first (IAS 36.60), booked as a revaluation decrease', function (): void {
        ($this->reval)([$this->a['id'] => 11000000, $this->b['id'] => 5000000], '2026-05-15');
        $this->postedRun('2026-05-15');
        $tx = ($this->txn)(['kind' => 'impairment', 'tx_date' => '2026-06-10', 'asset_id' => $this->a['id'], 'amount' => 1500000, 'reason' => 'Subsidence']);

        expect($this->journalLines($tx['journal_id']))->toBe([
            ['account' => '3300', 'debit' => 1166666, 'credit' => 0], ['account' => '8600', 'debit' => 333334, 'credit' => 0], ['account' => '1510', 'debit' => 0, 'credit' => 1500000],
        ]);
        expect(adb('journals')->where('id', $tx['journal_id'])->value('source_type'))->toBe('asset_revaluation')
            ->and(($this->asset)($this->a['id'])['revaluation_reserve']['amount'])->toBe(0);
        $this->asPerson($this->accountant)->postJson($this->api('asset-transactions'), [
            'kind' => 'impairment_reversal', 'tx_date' => '2026-06-10', 'asset_id' => $this->a['id'], 'amount' => 1, 'reason' => 'x',
        ], $this->key())->assertStatus(422)->assertJsonPath('code', 'reversal_revalued_asset');
    });

    it('moves the remaining reserve to retained earnings on disposal, never through profit or loss', function (): void {
        ($this->reval)([$this->a['id'] => 11000000, $this->b['id'] => 5000000], '2026-05-15');
        $this->postedRun('2026-05-15');
        $tx = ($this->txn)([
            'kind' => 'disposal', 'tx_date' => '2026-06-20', 'asset_id' => $this->a['id'], 'proceeds' => 11000000, 'proceeds_account_id' => $this->f->account('1000'), 'transfer_reserve' => true,
        ]);

        // Carrying 10,906,780 against proceeds 11,000,000: gain 93,220 in profit or loss; the reserve of 1,166,666 goes straight to equity.
        expect($this->journalLines($tx['journal_id']))->toBe([
            ['account' => '1510', 'debit' => 93220, 'credit' => 0], ['account' => '1000', 'debit' => 11000000, 'credit' => 0], ['account' => '1500', 'debit' => 0, 'credit' => 11000000],
            ['account' => '7500', 'debit' => 0, 'credit' => 93220], ['account' => '3300', 'debit' => 1166666, 'credit' => 0], ['account' => '3000', 'debit' => 0, 'credit' => 1166666],
        ]);
        expect(revalProblems())->toBe([]);
    });

    it('is not a cash flow: the cash flow statement shows no investing or financing offset for a revaluation', function (): void {
        // Cash in 5,000,000 from a sale (operating), then the revaluation.
        $this->postedDoc('journals', [
            'journal_date' => '2026-02-10', 'reference' => 'S', 'memo' => 'Sale',
            'lines' => [['account_id' => $this->f->account('1000'), 'debit' => 5000000], ['account_id' => $this->f->account('4000'), 'credit' => 5000000]],
        ]);
        $flow = fn () => $this->asPerson($this->accountant)->getJson($this->api('reports/cash-flow?from=2026-01-01&to=2026-06-30'))->assertOk()->json('data');
        $before = $flow();
        ($this->reval)([$this->a['id'] => 11000000, $this->b['id'] => 5000000], '2026-05-15');
        $after = $flow();

        expect($after['investing']['total']['amount'])->toBe($before['investing']['total']['amount'])
            ->and($after['financing']['total']['amount'])->toBe(0)->and($after['financing']['lines'])->toBe([])
            ->and($after['reconciles'])->toBeTrue()->and($after['unexplained']['amount'])->toBe(0)
            ->and($after['net_change_in_cash']['amount'])->toBe($before['net_change_in_cash']['amount']);
        // The loss of 900,000 reached profit, so it is taken back out of operating as non-cash.
        $items = collect($after['operating']['lines']);
        expect($items->firstWhere('key', 'non_cash_revaluation')['amount']['amount'])->toBe(900000)
            ->and($items->firstWhere('key', 'net_profit')['amount']['amount'])->toBe($items->firstWhere('key', 'net_profit')['amount']['amount']);
        $pl = $this->asPerson($this->accountant)->getJson($this->api('reports/profit-and-loss?from=2026-01-01&to=2026-06-30'))->json('data.subtotals.net_profit.amount.amount');
        expect($items->firstWhere('key', 'net_profit')['amount']['amount'])->toBe($pl);
    });
});
