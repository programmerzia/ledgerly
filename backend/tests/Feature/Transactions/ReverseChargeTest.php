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
 * Reverse charge (plan 3c.11, D15 item 4). A 10% reverse-charge code: the supplier charges no tax, so the bill's total is the net;
 * the buyer books output on the whole tax and input on the recoverable part. Not recoverable: the input is cost of the line (D10).
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->setUpTransactions();
    $this->inTenant(function (): void {
        foreach (['RC10' => true, 'RCNR' => false] as $code => $recoverable) {
            $id = (string) Str::uuid7();
            $this->t->tax[$code] = $id;
            DB::table('tax_codes')->insert(['id' => $id, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'code' => $code, 'name' => $code, 'kind' => 'reverse_charge', 'is_recoverable' => $recoverable]);
            DB::table('tax_rates')->insert(['id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'tax_code_id' => $id, 'rate' => '0.100000', 'effective_from' => '2020-01-01']);
        }
    });
});

it('nets a fully recoverable reverse-charge bill to zero and leaves the supplier owed the net only', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[10000, '1', 'RC10', '0', '5000']], '2026-03-15'));
    expect($bill['total']['amount'])->toBe(10000)->and($bill['amount_due']['amount'])->toBe(10000)->and($bill['tax_total']['amount'])->toBe(0)
        ->and($this->linesOf($bill['journal_id']))->toBe([['2000', 0, 10000], ['5000', 10000, 0], ['2302', 0, 1000], ['1302', 1000, 0]])
        ->and($this->net('2302') + $this->net('1302'))->toBe(0)->and($this->net('2000'))->toBe(-10000);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('puts non-recoverable reverse-charge input into the line expense while output is still owed', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[10000, '1', 'RCNR', '0', '5000']], '2026-03-15'));
    expect($this->linesOf($bill['journal_id']))->toBe([['2000', 0, 10000], ['5000', 11000, 0], ['2302', 0, 1000]])
        ->and($this->net('2302'))->toBe(-1000)->and($this->net('1302'))->toBe(0);
});

it('mixes ordinary VAT lines and reverse-charge lines on one bill', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[10000, '1', 'VAT10', '0', '5000'], [20000, '1', 'RC10', '0', '5000']], '2026-03-15'));
    // Supplier is owed 10,000 + 1,000 VAT + 20,000 = 31,000; reverse charge 2,000 is self-assessed.
    expect($bill['total']['amount'])->toBe(31000)->and($bill['tax_total']['amount'])->toBe(1000)
        ->and($this->linesOf($bill['journal_id']))->toBe([['2000', 0, 31000], ['5000', 10000, 0], ['5000', 20000, 0], ['2110', 1000, 0], ['2302', 0, 2000], ['1302', 2000, 0]]);
});

it('converts a foreign-currency reverse-charge bill once, output and input on the same base', function (): void {
    $this->t->rate('EUR', '2026-03-10', '1.10000000');
    $eur = $this->t->contact('SE', 'supplier', 'EUR');
    $bill = $this->postedDoc('bills', $this->t->body($eur, [[10000, '1', 'RC10', '0', '5010']], '2026-03-10', ['currency' => 'EUR']));
    expect($this->linesOf($bill['journal_id']))->toBe([['2000', 0, 11000], ['5010', 11000, 0], ['2302', 0, 1100], ['1302', 1100, 0]]);
    $this->inTenant(fn () => expect(LedgerChecks::problems())->toBe([]));
});

it('refuses reverse charge on a sales invoice and a credit note, and a missing account with a pointer to Settings', function (): void {
    $this->asPerson($this->accountant)->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[10000, '1', 'RC10']]), $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'reverse_charge_sales_forbidden');

    $this->inTenant(function (): void {
        $keys = json_decode((string) DB::table('company_settings')->where('company_id', $this->f->companyId)->value('posting_accounts'), true);
        unset($keys['reverse_charge_output']);
        DB::table('company_settings')->where('company_id', $this->f->companyId)->update(['posting_accounts' => json_encode($keys)]);
    });
    $draft = $this->draftDoc('bills', $this->t->body($this->t->supplier, [[10000, '1', 'RC10', '0', '5000']], '2026-03-15'));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("bills/{$draft['id']}/submit"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('violations.0.code', 'posting_account_missing');
});

it('leaves a bill without reverse charge exactly as it was', function (): void {
    $bill = $this->postedDoc('bills', $this->t->body($this->t->supplier, [[10000, '1', 'VAT10', '0', '5000'], [5000, '1', 'VATNR', '0', '5000']], '2026-03-15'));
    // Recoverable VAT 1,000 to input; non-recoverable VAT 500 joins its line's expense; no reverse-charge line, no reverse-charge total.
    expect($bill['total']['amount'])->toBe(16500)->and($this->linesOf($bill['journal_id']))->toBe([['2000', 0, 16500], ['5000', 10000, 0], ['5000', 5500, 0], ['2110', 1000, 0]]);
    $this->inTenant(fn () => expect((int) DB::table('invoices')->where('id', $bill['id'])->value('reverse_charge_total'))->toBe(0)->and(LedgerChecks::problems())->toBe([]));
    expect($this->net('2302'))->toBe(0)->and($this->net('1302'))->toBe(0);
});

it('shows both sides on the tax return', function (): void {
    $this->postedDoc('bills', $this->t->body($this->t->supplier, [[10000, '1', 'RC10', '0', '5000'], [4000, '1', 'RCNR', '0', '5000']], '2026-03-15'));
    $return = $this->asPerson($this->owner)->getJson($this->api('reports/tax-return?from=2026-03-01&to=2026-03-31'))->assertOk()->json('data');
    $rc = $return['reverse_charge'];
    expect($rc['totals']['base']['amount'])->toBe(14000)->and($rc['totals']['output']['amount'])->toBe(1400)->and($rc['totals']['input']['amount'])->toBe(1000)
        ->and($rc['totals']['net']['amount'])->toBe(400)->and($rc['rows'])->toHaveCount(2)
        ->and($return['net_tax_payable']['amount'])->toBe(400);
});
