<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;
use Tests\Support\TransactionsApi;

uses(MakesApiCalls::class, TradeApi::class, TransactionsApi::class);

/*
 * The transaction documents of plan 3c.8 to 3c.12 post only through the PostingEngine, so the ledger invariants hold after any
 * mix of them: every journal balances, the projection matches the lines, numbers are gapless, nothing posts into a closed
 * period, nobody approved what they made. Funds in transit return to zero once every transfer is completed or reversed.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->setUpTransactions();
});

it('keeps every ledger invariant through a mix of transfers, and leaves nothing in transit', function (): void {
    $this->workflow('fund_transfer');
    $make = fn (string $from, string $to, int $amount, int $toAmount, array $extra = []): array => $this->draftDoc('fund-transfers', [
        'from_bank_account_id' => $this->bank[$from], 'to_bank_account_id' => $this->bank[$to], 'send_date' => '2026-03-10',
        'from_amount_fc' => $amount, 'to_amount_fc' => $toAmount, ...$extra,
    ]);
    $approve = function (array $t): array {
        $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$t['id']}/submit"), [], $this->key())->assertOk();

        return $this->asPerson($this->approver, signing: true)->postJson($this->api("fund-transfers/{$t['id']}/approve"), [], $this->key())->assertOk()->json('data');
    };
    $receive = fn (array $t, string $date, ?int $amount = null): array => $this->asPerson($this->accountant, signing: true)
        ->postJson($this->api("fund-transfers/{$t['id']}/receive"), ['received_on' => $date, ...($amount === null ? [] : ['to_amount_fc' => $amount])], $this->key())->assertOk()->json('data');

    $a = $approve($make('1200', '1000', 100000, 109500, ['fee_fc' => 500, 'fee_account_id' => $this->f->account('6312')]));   // loss
    $b = $approve($make('1200', '1000', 20000, 22400));                                                                      // gain
    $c = $approve($make('1000', '1200', 30000, 27000));                                                                      // USD to EUR
    $d = $approve($make('1000', '1200', 10000, 9000));                                                                       // stays in transit, then reversed
    $receive($a, '2026-03-12');
    $receive($b, '2026-03-12', 22000);
    $receive($c, '2026-03-11');
    $this->asPerson($this->owner, signing: true)->postJson($this->api("fund-transfers/{$d['id']}/reverse"), [], $this->key())->assertOk();
    $this->asPerson($this->owner, signing: true)->postJson($this->api("fund-transfers/{$b['id']}/reverse"), ['date' => '2026-03-13'], $this->key())->assertOk();

    expect($this->net('1016'))->toBe(0);
    $this->inTenant(function (): void {
        expect(LedgerChecks::problems())->toBe([])
            ->and(DB::table('fund_transfers')->whereNotNull('number')->pluck('number')->sort()->values()->all())
            ->toBe(['TRF-FY2026-00001', 'TRF-FY2026-00002', 'TRF-FY2026-00003', 'TRF-FY2026-00004'])
            ->and(LedgerChecks::makerCheckerBreaches())->toBe([]);
    });
});

it('keeps AR, the aging and the allowance in step through write-offs, partial and full, and a reversal', function (): void {
    $this->fundAllowance(3000);
    $a = $this->sale(10000);
    $b = $this->sale(20000);
    $this->workflow('write_off');
    $write = function (array $invoice, int $amount) {
        $w = $this->draftDoc('write-offs', ['invoice_id' => $invoice['id'], 'write_off_date' => '2026-04-20', 'amount_fc' => $amount, 'reason' => 'Uncollectable']);
        $this->asPerson($this->accountant, signing: true)->postJson($this->api("write-offs/{$w['id']}/submit"), [], $this->key())->assertOk();

        return $this->asPerson($this->approver, signing: true)->postJson($this->api("write-offs/{$w['id']}/approve"), [], $this->key())->assertOk()->json('data');
    };
    $w1 = $write($a, 4000);
    $write($b, 22000);
    $write($a, 7000);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("write-offs/{$w1['id']}/reverse"), [], $this->key())->assertOk();

    $this->inTenant(function (): void {
        expect(LedgerChecks::problems())->toBe([])->and(LedgerChecks::makerCheckerBreaches())->toBe([]);
    });
    $aging = $this->asPerson($this->owner)->getJson($this->api('reports/ar-aging?as_of=2026-04-30'))->assertOk()->json('data');
    expect($aging['totals']['open']['amount'])->toBe($this->net('1100'))->and($this->net('1100'))->toBe(4000);
});

it('keeps the allowance equal to the matrix after provisioning runs, write-offs and a reversal', function (): void {
    $this->asPerson($this->owner)->putJson($this->api('provision-rates'), ['rates' => ['current' => '2', 'days_1_30' => '5', 'days_31_60' => '10', 'days_61_90' => '25', 'days_over_90' => '50']], $this->key())->assertOk();
    $this->postedDoc('invoices', $this->t->body($this->t->customer, [[100000, '1']], '2026-03-01', ['due_date' => '2026-03-31']));
    $big = $this->postedDoc('invoices', $this->t->body($this->t->customer, [[200000, '1']], '2026-03-01', ['due_date' => '2026-04-15']));

    $run = $this->asPerson($this->accountant)->postJson($this->api('provision-runs'), ['as_of' => '2026-06-30'], $this->key())->assertCreated()->json('data');
    $this->submitDoc('provision-runs', $run['id']);
    // 100,000 is 91 days late (50%) and 200,000 is 76 days late (25%): 50,000 + 50,000 = 100,000 held.
    expect($this->net('1190'))->toBe(-100000);

    // Writing off 200,000 spends the allowance first (100,000), the rest is expense.
    $w = $this->draftDoc('write-offs', ['invoice_id' => $big['id'], 'write_off_date' => '2026-07-01', 'amount_fc' => 200000, 'reason' => 'Insolvent']);
    $this->submitDoc('write-offs', $w['id']);
    expect($this->net('1190'))->toBe(0)->and($this->net('6801'))->toBe(200000);   // 100,000 provision + 100,000 beyond it

    $this->asPerson($this->owner, signing: true)->postJson($this->api("provision-runs/{$run['id']}/reverse"), ['date' => '2026-07-02'], $this->key())->assertOk();
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([])->and(LedgerChecks::makerCheckerBreaches())->toBe([]));
});
