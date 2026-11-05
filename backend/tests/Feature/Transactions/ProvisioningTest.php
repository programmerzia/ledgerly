<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;
use Tests\Support\TransactionsApi;

uses(MakesApiCalls::class, TradeApi::class, TransactionsApi::class);

/*
 * Provisioning (plan 3c.10, D15 item 2). As of 2026-06-30 the customer owes, by due date: not yet due 1,000.00, 1-30 days 2,000.00,
 * 31-60 3,000.00, 61-90 4,000.00, over 90 5,000.00. Rates 1%, 5%, 10%, 25%, 50% give 10 + 100 + 300 + 1,000 + 2,500 = 3,910.00 (391,000).
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->setUpTransactions();
    foreach ([['2026-06-30', 100000], ['2026-06-15', 200000], ['2026-05-15', 300000], ['2026-04-15', 400000], ['2026-03-15', 500000]] as [$due, $price]) {
        $this->postedDoc('invoices', $this->t->body($this->t->customer, [[$price, '1']], '2026-03-01', ['due_date' => $due]));
    }
    $this->rates = ['current' => '1', 'days_1_30' => '5', 'days_31_60' => '10', 'days_61_90' => '25', 'days_over_90' => '50'];
});

it('previews required, held and the difference by bucket from the aging, and refuses to run without rates', function (): void {
    $this->asPerson($this->accountant)->postJson($this->api('provision-runs/preview'), ['as_of' => '2026-06-30'], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'provision_rates_missing');

    $this->asPerson($this->accountant)->putJson($this->api('provision-rates'), ['rates' => $this->rates], $this->key())->assertForbidden();
    $this->asPerson($this->owner)->putJson($this->api('provision-rates'), ['rates' => $this->rates], $this->key())->assertOk()->assertJsonPath('data.configured', true);
    $this->fundAllowance(91000);

    $p = $this->asPerson($this->accountant)->postJson($this->api('provision-runs/preview'), ['as_of' => '2026-06-30'], $this->key())->assertOk()->json('data');
    expect(array_column(array_map(fn ($b) => ['k' => $b['bucket'], 'v' => $b['balance']['amount']], $p['buckets']), 'v', 'k'))
        ->toBe(['current' => 100000, 'days_1_30' => 200000, 'days_31_60' => 300000, 'days_61_90' => 400000, 'days_over_90' => 500000])
        ->and(array_map(fn ($b) => $b['amount']['amount'], $p['buckets']))->toBe([1000, 10000, 30000, 100000, 250000])
        ->and($p['required']['amount'])->toBe(391000)->and($p['existing']['amount'])->toBe(91000)->and($p['difference']['amount'])->toBe(300000);
});

it('posts only the difference through approval, Dr expense and Cr allowance, once per period, and is not auto-reversing', function (): void {
    $this->asPerson($this->owner)->putJson($this->api('provision-rates'), ['rates' => $this->rates], $this->key())->assertOk();
    $this->fundAllowance(91000);
    $this->workflow('provision_run');

    $run = $this->asPerson($this->accountant)->postJson($this->api('provision-runs'), ['as_of' => '2026-06-30'], $this->key())->assertCreated()->json('data');
    expect($run['difference']['amount'])->toBe(300000)->and($run['buckets'])->toHaveCount(5);
    $this->asPerson($this->accountant)->postJson($this->api('provision-runs'), ['as_of' => '2026-06-30'], $this->key())->assertStatus(422)->assertJsonPath('code', 'provision_run_exists');

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("provision-runs/{$run['id']}/submit"), [], $this->key())->assertOk();
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("provision-runs/{$run['id']}/approve"), [], $this->key())->assertForbidden();
    $posted = $this->asPerson($this->approver, signing: true)->postJson($this->api("provision-runs/{$run['id']}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', 'PRV-FY2026-00001')->json('data');

    expect($this->linesOf($posted['journal_id']))->toBe([['6801', 300000, 0], ['1190', 0, 300000]])
        ->and($this->net('1190'))->toBe(-391000);   // the allowance now holds exactly what the matrix requires
    $again = $this->asPerson($this->accountant)->postJson($this->api('provision-runs/preview'), ['as_of' => '2026-06-30'], $this->key())->assertOk()->json('data');
    expect($again['difference']['amount'])->toBe(0);

    // Reversal frees the period for a new run; the allowance goes back to 91,000.
    $this->asPerson($this->owner, signing: true)->postJson($this->api("provision-runs/{$run['id']}/reverse"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'reversed');
    expect($this->net('1190'))->toBe(-91000);
    $this->asPerson($this->accountant)->postJson($this->api('provision-runs'), ['as_of' => '2026-06-30'], $this->key())->assertCreated();
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([])->and(DB::table('provision_runs')->whereNotNull('number')->count())->toBe(1));
});

it('releases the allowance when it exceeds what is required, Dr allowance and Cr expense', function (): void {
    $this->asPerson($this->owner)->putJson($this->api('provision-rates'), ['rates' => $this->rates], $this->key())->assertOk();
    $this->fundAllowance(500000);
    $run = $this->asPerson($this->accountant)->postJson($this->api('provision-runs'), ['as_of' => '2026-06-30'], $this->key())->assertCreated()->json('data');
    expect($run['difference']['amount'])->toBe(-109000);
    $posted = $this->submitDoc('provision-runs', $run['id']);
    expect($this->linesOf($posted['journal_id']))->toBe([['1190', 109000, 0], ['6801', 0, 109000]])->and($this->net('1190'))->toBe(-391000);
});

it('refuses a run that went stale, a closed period, and nothing to post', function (): void {
    $this->asPerson($this->owner)->putJson($this->api('provision-rates'), ['rates' => $this->rates], $this->key())->assertOk();
    $run = $this->asPerson($this->accountant)->postJson($this->api('provision-runs'), ['as_of' => '2026-06-30'], $this->key())->assertCreated()->json('data');
    expect($run['existing']['amount'])->toBe(0);
    $this->fundAllowance(50000);   // the ledger moves after the run was prepared
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("provision-runs/{$run['id']}/submit"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('violations.0.code', 'provision_run_stale');

    $this->asPerson($this->owner, signing: true)->postJson($this->api("provision-runs/{$run['id']}/void"), ['reason' => 'Stale'], $this->key())->assertOk();
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-06-30', 'closed'));
    $this->asPerson($this->accountant)->postJson($this->api('provision-runs'), ['as_of' => '2026-06-30'], $this->key())->assertStatus(422)->assertJsonPath('code', 'period_closed');
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-06-30', 'open'));
    $this->fundAllowance(341000);   // 50,000 + 341,000 = 391,000 held: exactly the requirement
    $this->asPerson($this->accountant)->postJson($this->api('provision-runs'), ['as_of' => '2026-06-30'], $this->key())->assertStatus(422)->assertJsonPath('code', 'provision_no_difference');
});
