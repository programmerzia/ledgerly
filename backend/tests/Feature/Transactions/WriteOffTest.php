<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;
use Tests\Support\TransactionsApi;

uses(MakesApiCalls::class, TradeApi::class, TransactionsApi::class);

/*
 * Write-offs (plan 3c.9, D15 item 2). A posted invoice of 100.00 + 10% VAT is 110.00 receivable (11,000). The allowance holds 40.00
 * (4,000) from a provision journal, so a full write-off is Dr allowance 4,000, Dr bad-debt expense 7,000, Cr AR 11,000.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->setUpTransactions();
});

/** @return array<string, mixed> */
function writeOffBody(object $test, array $invoice, int $amount, array $extra = []): array
{
    return ['invoice_id' => $invoice['id'], 'write_off_date' => '2026-04-20', 'amount_fc' => $amount, 'reason' => 'Customer insolvent', ...$extra];
}

it('uses the allowance first, then expense, credits AR with the contact, and takes the invoice out of aging', function (): void {
    $this->fundAllowance(4000);
    $invoice = $this->sale(10000);
    expect($invoice['amount_due']['amount'])->toBe(11000)->and($this->net('1100'))->toBe(11000);
    $this->workflow('write_off');

    $w = $this->draftDoc('write-offs', writeOffBody($this, $invoice, 11000));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("write-offs/{$w['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("write-offs/{$w['id']}/approve"), [], $this->key())->assertForbidden();
    $posted = $this->asPerson($this->approver, signing: true)->postJson($this->api("write-offs/{$w['id']}/approve"), [], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', 'WO-FY2026-00001')
        ->assertJsonPath('data.allowance_used.amount', 4000)->assertJsonPath('data.expense.amount', 7000)->json('data');

    expect($this->linesOf($posted['journal_id']))->toBe([['1190', 4000, 0], ['6801', 7000, 0], ['1100', 0, 11000]])
        ->and($this->net('1100'))->toBe(0)->and($this->net('1190'))->toBe(0)->and($this->net('6801'))->toBe(11000);   // 4,000 from the provision journal, 7,000 from the write-off
    $this->inTenant(function () use ($invoice, $posted): void {
        $line = DB::table('journal_lines')->where('journal_id', $posted['journal_id'])->where('account_id', $this->f->account('1100'))->first();
        expect($line->contact_id)->toBe($this->t->customer)->and((int) DB::table('invoices')->where('id', $invoice['id'])->value('settled'))->toBe(11000)
            ->and(LedgerChecks::problems())->toBe([]);
    });
    $shown = $this->document('invoices', $invoice['id']);
    expect($shown['amount_due']['amount'])->toBe(0);
    $aging = $this->asPerson($this->owner)->getJson($this->api('reports/ar-aging?as_of=2026-04-30'))->assertOk()->json('data');
    expect($aging['rows'])->toBe([]);

    // Reversal restores the open amount and the aging row.
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("write-offs/{$w['id']}/reverse"), [], $this->key())->assertForbidden();
    $this->asPerson($this->owner, signing: true)->postJson($this->api("write-offs/{$w['id']}/reverse"), ['date' => '2026-04-21'], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'reversed');
    expect($this->net('1100'))->toBe(11000)->and($this->net('1190'))->toBe(-4000)->and($this->document('invoices', $invoice['id'])['amount_due']['amount'])->toBe(11000);
    $again = $this->asPerson($this->owner)->getJson($this->api('reports/ar-aging?as_of=2026-04-30'))->assertOk()->json('data');
    expect($again['totals']['open']['amount'])->toBe(11000);
});

it('charges everything to expense when the allowance is empty, and only what is left when it is partly used', function (): void {
    $a = $this->sale(10000);
    $b = $this->sale(5000);   // 5,500
    $w1 = $this->draftDoc('write-offs', writeOffBody($this, $a, 3000));
    $p1 = $this->submitDoc('write-offs', $w1['id']);
    expect($this->linesOf($p1['journal_id']))->toBe([['6801', 3000, 0], ['1100', 0, 3000]]);   // a partial write-off, no allowance

    $this->fundAllowance(2500);
    $w2 = $this->draftDoc('write-offs', writeOffBody($this, $b, 5500));
    $p2 = $this->submitDoc('write-offs', $w2['id']);
    expect($this->linesOf($p2['journal_id']))->toBe([['1190', 2500, 0], ['6801', 3000, 0], ['1100', 0, 5500]]);
    $shown = $this->document('invoices', $a['id']);
    expect($shown['amount_due']['amount'])->toBe(8000);
});

it('refuses more than the open amount, a reason-less write-off, a credit note, a closed period and a missing allowance account', function (): void {
    $invoice = $this->sale(10000);
    $this->asPerson($this->accountant)->postJson($this->api('write-offs'), writeOffBody($this, $invoice, 11001), $this->key())->assertStatus(422)->assertJsonPath('code', 'write_off_exceeds_open_amount');
    $this->asPerson($this->accountant)->postJson($this->api('write-offs'), writeOffBody($this, $invoice, 100, ['reason' => '  ']), $this->key())->assertStatus(422);
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[5000, '1']], '2026-03-01'));
    $this->asPerson($this->accountant)->postJson($this->api('write-offs'), writeOffBody($this, $bill, 100), $this->key())->assertStatus(422);

    $w = $this->draftDoc('write-offs', writeOffBody($this, $invoice, 1000));
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-04-20', 'closed'));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("write-offs/{$w['id']}/submit"), [], $this->key())->assertStatus(422);
    $this->inTenant(fn () => $this->f->setPeriodStatus('2026-04-20', 'open'));

    $this->inTenant(function (): void {
        $keys = json_decode((string) DB::table('company_settings')->where('company_id', $this->f->companyId)->value('posting_accounts'), true);
        unset($keys['credit_loss_allowance']);
        DB::table('company_settings')->where('company_id', $this->f->companyId)->update(['posting_accounts' => json_encode($keys)]);
    });
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("write-offs/{$w['id']}/submit"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('violations.0.code', 'posting_account_missing');
    expect($this->inTenant(fn () => DB::table('write_offs')->whereNotNull('number')->count()))->toBe(0);
});

it('carries a foreign-currency invoice at its own rate, so nothing is gained or lost on the write-off', function (): void {
    $this->t->rate('EUR', '2026-03-10', '1.10000000');
    $eur = $this->t->contact('CE', 'customer', 'EUR');
    $invoice = $this->postedDoc('invoices', $this->t->body($eur, [[10000, '1', null, '0', '4010']], '2026-03-10', ['currency' => 'EUR']));
    expect($invoice['total']['amount'])->toBe(11000);   // EUR 100.00 at 1.10 is USD 110.00
    $w = $this->draftDoc('write-offs', writeOffBody($this, $invoice, 4000));
    $p = $this->submitDoc('write-offs', $w['id']);
    expect($this->linesOf($p['journal_id']))->toBe([['6801', 4400, 0], ['1100', 0, 4400]]);
    $this->inTenant(function () use ($p): void {
        $line = DB::table('journal_lines')->where('journal_id', $p['journal_id'])->where('account_id', $this->f->account('1100'))->first();
        expect($line->currency)->toBe('EUR')->and((int) $line->amount_fc)->toBe(-4000);
    });
    // The write-off that clears the rest takes the remaining base exactly.
    $w2 = $this->draftDoc('write-offs', writeOffBody($this, $invoice, 6000));
    $p2 = $this->submitDoc('write-offs', $w2['id']);
    expect($this->linesOf($p2['journal_id']))->toBe([['6801', 6600, 0], ['1100', 0, 6600]]);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});
