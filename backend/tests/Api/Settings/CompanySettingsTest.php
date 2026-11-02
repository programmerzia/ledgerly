<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

beforeEach(function (): void {
    $this->setUpTrade();
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
});

it('shows the profile and posting accounts, with account names, to anyone who can view settings', function (): void {
    $this->asPerson($this->viewer)->getJson($this->api('settings'))->assertOk()
        ->assertJsonPath('data.base_currency', 'USD')->assertJsonPath('data.tax_rounding', 'document_per_code')
        ->assertJsonPath('data.posting_accounts.ar_control.code', '1100')
        ->assertJsonPath('data.posting_accounts.ap_control.code', '2000') // stored as a code by older rows, shown as the account
        ->assertJsonPath('data.posting_accounts.suspense', null)->assertJsonPath('data.can.update', false);
});

it('changes the profile, tax rounding and posting accounts, audited, and refuses what would misdirect a posting', function (): void {
    $this->asPerson($this->owner);
    $this->putJson($this->api('settings'), [
        'name' => 'Acme Trading', 'legal_name' => 'Acme Trading LLC', 'tax_id' => 'TAX-9', 'timezone' => 'Africa/Mogadishu', 'tax_rounding' => 'line',
        'posting_accounts' => ['suspense' => $this->f->account('1300'), 'ar_control' => $this->f->account('1100')],
    ], $this->key())->assertOk()
        ->assertJsonPath('data.name', 'Acme Trading')->assertJsonPath('data.timezone', 'Africa/Mogadishu')->assertJsonPath('data.tax_rounding', 'line')
        ->assertJsonPath('data.posting_accounts.suspense.code', '1300')->assertJsonPath('data.posting_accounts.ar_control.account_id', $this->f->account('1100'))
        ->assertJsonPath('data.posting_accounts.fx_realised.code', '7100')->assertJsonPath('data.can.update', true);
    expect($this->inTenant(fn () => DB::table('audit_events')->where('action', 'company_settings.updated')->count()))->toBe(1);

    // Partial: the other keys stay.
    $this->putJson($this->api('settings'), ['posting_accounts' => ['suspense' => null]], $this->key())->assertOk()->assertJsonPath('data.posting_accounts.suspense', null)->assertJsonPath('data.posting_accounts.ar_control.code', '1100')->assertJsonPath('data.tax_rounding', 'line');

    // The receivable key needs an AR control account; an expense account is no tax account; unknown keys, foreign ids, immutable fields.
    $this->putJson($this->api('settings'), ['posting_accounts' => ['ar_control' => $this->f->account('4000')]], $this->key())->assertStatus(422)->assertJson(['code' => 'posting_account_wrong_control']);
    $this->putJson($this->api('settings'), ['posting_accounts' => ['tax_output' => $this->f->account('5000')]], $this->key())->assertStatus(422)->assertJson(['code' => 'posting_account_wrong_control']);
    $this->putJson($this->api('settings'), ['posting_accounts' => ['bogus' => $this->f->account('1300')]], $this->key())->assertStatus(422)->assertJsonValidationErrors(['posting_accounts']);
    $this->putJson($this->api('settings'), ['posting_accounts' => ['rounding' => (string) Str::uuid7()]], $this->key())->assertStatus(422)->assertJsonValidationErrors(['posting_accounts.rounding']);
    $this->putJson($this->api('settings'), ['base_currency' => 'EUR'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['base_currency']);
    $this->putJson($this->api('settings'), ['numbering' => ['invoice_prefix' => 'X']], $this->key())->assertStatus(422)->assertJsonValidationErrors(['numbering']);
    $this->putJson($this->api('settings'), ['tax_rounding' => 'whatever'], $this->key())->assertStatus(422)->assertJsonValidationErrors(['tax_rounding']);
});

it('keeps settings with people who manage them', function (): void {
    $this->asPerson($this->viewer)->putJson($this->api('settings'), ['name' => 'X'], $this->key())->assertForbidden();
    $this->asPerson($this->accountant)->putJson($this->api('settings'), ['name' => 'X'], $this->key())->assertForbidden();
    $this->asToken($this->newToken(['invoices:read', 'invoices:write']))->getJson($this->api('settings'))->assertForbidden();
    $this->asToken($this->newToken(['invoices:read']))->putJson($this->api('settings'), ['name' => 'X'], $this->key())->assertForbidden();
});

it('uses the posting accounts that were set when a settlement posts', function (): void {
    // The existing resolver reads accounts by code or id; ids written by the settings screen keep working.
    $this->asPerson($this->owner)->putJson($this->api('settings'), ['posting_accounts' => ['ap_control' => $this->f->account('2000'), 'ar_control' => $this->f->account('1100')]], $this->key())->assertOk();
    $invoice = $this->sale(10000);
    $this->postedSettlement('receipt', $this->t->customer, 11000, [[$invoice['id'], 11000]]);
    expect($this->document('invoices', $invoice['id'])['payment_status'])->toBe('paid');
});
