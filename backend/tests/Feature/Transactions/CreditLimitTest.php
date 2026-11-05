<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;
use Tests\Support\TransactionsApi;

uses(MakesApiCalls::class, TradeApi::class, TransactionsApi::class);

/*
 * Credit limit at invoice submit (plan 3c.12). Customer limit 200.00 (20,000). Each sale of 100.00 + 10% VAT is 110.00 (11,000): the
 * first fits, the second brings the customer to 220.00 receivable.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->setUpTransactions();
    $this->inTenant(function (): void {
        DB::table('contacts')->where('id', $this->t->customer)->update(['credit_limit' => 20000]);
    });
    $this->mode = function (string $mode): void {
        $this->inTenant(fn () => DB::table('company_settings')->where('company_id', $this->f->companyId)->update(['credit_limit_mode' => $mode]));
    };
});

it('does nothing while the setting is off, even far over the limit', function (): void {
    $this->sale(10000);
    $second = $this->sale(10000);
    expect($second['status'])->toBe('posted');
});

it('warns in warn mode: the invoice still posts and the submit answer carries the warning', function (): void {
    ($this->mode)('warn');
    $this->sale(10000);
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));
    $res = $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$draft['id']}/submit"), [], $this->key())->assertOk()
        ->assertJsonPath('data.status', 'posted')->assertJsonPath('warnings.0.code', 'credit_limit_exceeded');
    expect($res->json('warnings.0.message'))->toContain('220.00')->toContain('200.00');
    $this->inTenant(fn () => expect(DB::table('credit_limit_checks')->where('outcome', 'warned')->count())->toBe(1));

    $within = $this->draftDoc('invoices', $this->t->body($this->inTenant(fn () => $this->t->contact('C2', 'customer')), [[10000, '1', 'VAT10']]));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$within['id']}/submit"), [], $this->key())->assertOk()->assertJsonPath('warnings', []);
});

it('refuses in refuse mode with credit_limit_exceeded and consumes no number', function (): void {
    ($this->mode)('refuse');
    $this->sale(10000);
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$draft['id']}/submit"), [], $this->key())
        ->assertStatus(422)->assertJsonPath('code', 'credit_limit_exceeded');
    $this->inTenant(fn () => expect(DB::table('invoices')->where('status', 'posted')->count())->toBe(1)->and(LedgerChecks::problems())->toBe([]));
});

it('lets a second person with the permission override with a reason, audited, and never the invoice maker', function (): void {
    ($this->mode)('refuse');
    $this->sale(10000);
    $draft = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]));
    $body = ['credit_limit_override_reason' => 'Paid in full next week, agreed with finance'];

    // The accountant made it and holds no override permission; the assistant has none either.
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$draft['id']}/submit"), $body, $this->key())->assertForbidden()->assertJsonPath('code', 'credit_limit_override_forbidden');
    // An owner who made the invoice themselves may not override it.
    $own = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]), $this->owner);
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$own['id']}/submit"), $body, $this->key())->assertForbidden()->assertJsonPath('code', 'credit_limit_override_self_forbidden');
    // Another person with the permission can.
    $this->asPerson($this->owner, signing: true)->postJson($this->api("invoices/{$draft['id']}/submit"), $body, $this->key())->assertOk()->assertJsonPath('data.status', 'posted');

    $this->inTenant(function () use ($draft): void {
        $row = DB::table('credit_limit_checks')->where('invoice_id', $draft['id'])->first();
        expect($row->outcome)->toBe('overridden')->and($row->reason)->toBe($body['credit_limit_override_reason'] ?? 'Paid in full next week, agreed with finance')
            ->and((int) $row->exposure)->toBe(22000)->and((int) $row->limit_base)->toBe(20000)->and($row->decided_by)->toBe($this->owner->id)
            ->and(DB::table('audit_events')->where('action', 'invoice.credit_limit_overridden')->count())->toBe(1)
            ->and(LedgerChecks::problems())->toBe([]);
    });
});

it('compares in base using the contact currency: a EUR limit is converted, and exposure equal to the limit passes', function (): void {
    ($this->mode)('refuse');
    $this->t->rate('EUR', '2026-03-15', '1.10000000');
    $eur = $this->inTenant(fn () => $this->t->contact('CE', 'customer', 'EUR'));
    $this->inTenant(fn () => DB::table('contacts')->where('id', $eur)->update(['credit_limit' => 20000]));   // EUR 200.00 = USD 220.00
    $body = fn (int $price) => $this->t->body($eur, [[$price, '1', null, '0', '4010']], '2026-03-15', ['currency' => 'EUR']);
    $this->postedDoc('invoices', $body(10000));                                 // EUR 100.00 = USD 110.00
    $second = $this->draftDoc('invoices', $body(10000));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$second['id']}/submit"), [], $this->key())->assertOk();   // 220.00 = limit

    $third = $this->draftDoc('invoices', $body(1));
    $this->asPerson($this->accountant, signing: true)->postJson($this->api("invoices/{$third['id']}/submit"), [], $this->key())->assertStatus(422)->assertJsonPath('code', 'credit_limit_exceeded');
});
