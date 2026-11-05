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
