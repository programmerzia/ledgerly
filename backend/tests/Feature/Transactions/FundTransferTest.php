<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;
use Tests\Support\TransactionsApi;

uses(MakesApiCalls::class, TradeApi::class, TransactionsApi::class);

/*
 * Fund transfers (plan 3c.8, D15 item 3). Base currency USD. 1000 is a USD cash account, 1200 a EUR bank account; EUR/USD is 1.10 on
 * 2026-03-10 and 1.12 on 2026-03-12. Worked example: send EUR 1,000.00 with a EUR 5.00 fee at 1.10, receive USD 1,095.00.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->setUpTransactions();
});

/** @param array<string, mixed> $extra */
function transferBody(object $test, string $from, string $to, int $amount, array $extra = []): array
{
    return [
        'from_bank_account_id' => $test->bank[$from], 'to_bank_account_id' => $test->bank[$to], 'send_date' => '2026-03-10',
        'from_amount_fc' => $amount, 'reference' => 'TRF-1', ...$extra,
    ];
}

it('sends and receives across currencies, each leg at its own rate, and books a realised FX loss', function (): void {
    $this->workflow('fund_transfer');
    $draft = $this->draftDoc('fund-transfers', transferBody($this, '1200', '1000', 100000, ['to_amount_fc' => 109500, 'fee_fc' => 500, 'fee_account_id' => $this->f->account('6312')]));
    expect($draft['send_base']['amount'])->toBe(110000)->and($draft['status'])->toBe('draft');

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/approve"), [], $this->key())->assertForbidden();
    $sent = $this->asPerson($this->approver, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.leg_state', 'in_transit')->assertJsonPath('data.number', 'TRF-FY2026-00001')->json('data');

    // Send leg: Dr in transit 1,100.00, Dr fee 5.50, Cr EUR bank 1,105.50 (EUR 1,005.00 at 1.10).
    expect($this->linesOf($sent['send_journal_id']))->toBe([['1016', 110000, 0], ['6312', 550, 0], ['1200', 0, 110550]])
        ->and($this->net('1016'))->toBe(110000);

    // Receive: arrives 2026-03-12; USD cash 1,095.00; 5.00 of the 1,100.00 in transit is lost.
    $this->asPerson($this->accountant)->postJson($this->api("fund-transfers/{$draft['id']}/receive"), ['received_on' => '2026-03-12'], $this->key())->assertForbidden();
    $done = $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/receive"), ['received_on' => '2026-03-12'], $this->key())
        ->assertOk()->assertJsonPath('data.leg_state', 'completed')->assertJsonPath('data.fx_difference.amount', -500)->json('data');
    expect($this->linesOf($done['receive_journal_id']))->toBe([['1000', 109500, 0], ['7200', 500, 0], ['1016', 0, 110000]])
        ->and($this->net('1016'))->toBe(0)->and($this->net('1000'))->toBe(109500)->and($this->net('7200'))->toBe(500);

    $this->inTenant(function () use ($done): void {
        $line = DB::table('journal_lines')->where('journal_id', $done['send_journal_id'])->where('account_id', $this->f->account('1200'))->first();
        expect($line->currency)->toBe('EUR')->and((int) $line->amount_fc)->toBe(-100500)->and((float) $line->fx_rate)->toBe(1.1)
            ->and(LedgerChecks::problems())->toBe([]);
    });
});

it('books a realised FX gain when more base arrives than left', function (): void {
    $draft = $this->draftDoc('fund-transfers', transferBody($this, '1200', '1000', 100000, ['to_amount_fc' => 110400]));
    $sent = $this->submitDoc('fund-transfers', $draft['id']);
    expect($this->linesOf($sent['send_journal_id']))->toBe([['1016', 110000, 0], ['1200', 0, 110000]]);

    $done = $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/receive"), ['received_on' => '2026-03-10'], $this->key())
        ->assertOk()->assertJsonPath('data.fx_difference.amount', 400)->json('data');
    expect($this->linesOf($done['receive_journal_id']))->toBe([['1000', 110400, 0], ['1016', 0, 110000], ['7100', 0, 400]])
        ->and($this->net('1016'))->toBe(0)->and($this->net('7100'))->toBe(-400);
});

it('can post both legs the same day through funds in transit, and reverses both legs together', function (): void {
    $draft = $this->draftDoc('fund-transfers', transferBody($this, '1200', '1000', 50000, ['to_amount_fc' => 55000, 'settle_same_day' => true]));
    $posted = $this->submitDoc('fund-transfers', $draft['id']);
    expect($posted['leg_state'])->toBe('completed')->and($this->net('1016'))->toBe(0)
        ->and($this->linesOf($posted['send_journal_id']))->toBe([['1016', 55000, 0], ['1200', 0, 55000]])
        ->and($this->linesOf($posted['receive_journal_id']))->toBe([['1000', 55000, 0], ['1016', 0, 55000]]);

    $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/reverse"), [], $this->key())->assertForbidden();
    $rev = $this->asPerson($this->owner, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/reverse"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'reversed')->json('data');
    expect($rev['send_reversal_journal_id'])->not->toBeNull()->and($rev['receive_reversal_journal_id'])->not->toBeNull()
        ->and($this->net('1000'))->toBe(0)->and($this->net('1200'))->toBe(0)->and($this->net('1016'))->toBe(0);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/reverse"), [], $this->key())->assertForbidden();
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('reverses only the send leg while the money is in transit, and refuses to receive afterwards', function (): void {
    $draft = $this->draftDoc('fund-transfers', transferBody($this, '1000', '1200', 22000, ['to_amount_fc' => 20000]));
    $sent = $this->submitDoc('fund-transfers', $draft['id']);
    $rev = $this->asPerson($this->owner, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/reverse"), [], $this->key())->assertOk()->json('data');
    expect($rev['receive_reversal_journal_id'])->toBeNull()->and($this->net('1016'))->toBe(0)->and($this->net('1000'))->toBe(0);
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/receive"), ['received_on' => '2026-03-11'], $this->key())->assertStatus(403);
    expect($sent['number'])->toBe('TRF-FY2026-00001');
});

it('refuses a missing funds-in-transit account with a pointer to Settings, closed periods, and non-bank accounts', function (): void {
    $this->inTenant(function (): void {
        $row = DB::table('company_settings')->where('company_id', $this->f->companyId)->first();
        $keys = json_decode((string) $row->posting_accounts, true);
        unset($keys['bank_in_transit']);
        DB::table('company_settings')->where('company_id', $this->f->companyId)->update(['posting_accounts' => json_encode($keys)]);
    });
    $draft = $this->draftDoc('fund-transfers', transferBody($this, '1200', '1000', 10000, ['to_amount_fc' => 11000]));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/submit"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('violations.0.code', 'posting_account_missing');
    $this->inTenant(fn () => $this->setPostingKeys(['bank_in_transit' => '1016']));

    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-03-10', 'closed'));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/submit"), [], $this->key())->assertStatus(422);
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-03-10', 'open'));

    $this->asPerson($this->accountant)->postJson($this->api('fund-transfers'), [
        ...transferBody($this, '1200', '1000', 10000, ['to_amount_fc' => 11000]), 'to_bank_account_id' => $this->bank['1200'],
    ], $this->key())->assertStatus(422);
    expect($this->inTenant(fn () => DB::table('journals')->where('source_type', 'fund_transfer')->count()))->toBe(0);
});

it('lets a bank statement line match each leg', function (): void {
    $draft = $this->draftDoc('fund-transfers', transferBody($this, '1200', '1000', 100000, ['to_amount_fc' => 110000]));
    $sent = $this->submitDoc('fund-transfers', $draft['id']);
    $done = $this->asPerson($this->accountant, signing: true)->postJson($this->api("fund-transfers/{$draft['id']}/receive"), ['received_on' => '2026-03-11'], $this->key())->assertOk()->json('data');

    $lines = [];
    $this->inTenant(function () use ($sent, $done, &$lines): void {
        foreach ([[$sent['send_journal_id'], '1200', -100000], [$done['receive_journal_id'], '1000', 110000]] as [$journal, $code, $amount]) {
            $line = DB::table('journal_lines')->where('journal_id', $journal)->where('account_id', $this->f->account($code))->first();
            $stmt = (string) Str::uuid7();
            $bank = $this->bank[$code];
            DB::table('bank_statements')->insert([
                'id' => $stmt, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'bank_account_id' => $bank, 'period_from' => '2026-03-01',
                'period_to' => '2026-03-31', 'currency' => $code === '1200' ? 'EUR' : 'USD', 'source' => 'manual', 'file_hash' => str_repeat($code === '1200' ? 'a' : 'b', 64), 'imported_at' => now(),
            ]);
            $sl = (string) Str::uuid7();
            DB::table('bank_statement_lines')->insert([
                'id' => $sl, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'statement_id' => $stmt, 'bank_account_id' => $bank, 'line_no' => 1,
                'txn_date' => '2026-03-11', 'amount' => (int) $line->amount_fc, 'currency' => $line->currency, 'dedupe_hash' => str_repeat('c', 64),
            ]);
            $lines[] = [$sl, $line->id, $amount];
        }
    });
    foreach ($lines as [$sl, $lineId, $amount]) {
        $this->asPerson($this->owner)->postJson($this->api('bank-matches'), ['statement_line_ids' => [$sl], 'journal_line_ids' => [$lineId]], $this->key())
            ->assertCreated()->assertJsonPath('data.amount.amount', $amount);
    }
});
