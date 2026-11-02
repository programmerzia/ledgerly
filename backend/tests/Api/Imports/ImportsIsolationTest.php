<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\BankingApi;
use Tests\Support\ImportsApi;
use Tests\Support\MakesApiCalls;
use Tests\Support\TradeApi;

/* Imports never cross companies: another company's import is a 404, its codes are not found, its bank account is a 422. */

uses(MakesApiCalls::class, TradeApi::class, BankingApi::class, ImportsApi::class);

beforeEach(function (): void {
    $this->setUpBanking();
    $this->beta = $this->secondCompany();
    $this->both = $this->person('Both Owner', ['Owner']);
    $this->inTenant(fn () => app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($this->both->id, $this->beta->id, 'Owner')));
    $this->inTenant(function (): void {
        DB::table('accounts')->insert(['id' => $this->betaAccount = (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'code' => '7777', 'name' => 'Beta only', 'account_type' => 'expense', 'normal_balance' => 'debit']);
        DB::table('contacts')->insert(['id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'kind' => 'customer', 'code' => 'B-CUST', 'name' => 'Beta customer', 'default_currency' => 'USD']);
    });
});

it('answers 404 for every route of an import that belongs to the other company, and 422 for foreign codes and bank accounts', function (): void {
    $import = $this->previewed('contacts', "Code,Name\nA-1,Alpha\n", ['code' => 'Code', 'name' => 'Name']);

    $this->asPerson($this->both, signing: true);
    foreach ([['GET', ''], ['PUT', '/mapping'], ['POST', '/preview'], ['POST', '/apply'], ['GET', '/rows'], ['POST', '/purge']] as [$method, $suffix]) {
        $this->json($method, $this->api("imports/{$import['id']}{$suffix}", $this->beta->id), [], $this->key())->assertNotFound()->assertJson(['code' => 'not_found']);
    }
    // Under its own company the same id is fine, and the other company's list does not show it.
    $this->getJson($this->api("imports/{$import['id']}"))->assertOk();
    $this->getJson($this->api('imports', $this->beta->id))->assertOk()->assertJsonCount(0, 'data');

    // Foreign account and contact codes are simply not found in this company.
    $tb = $this->previewed('opening_balances', "Account,Debit,Credit,Party\n7777,10.00,,\n1000,,10.00,\n", ['account' => 'Account', 'debit' => 'Debit', 'credit' => 'Credit', 'contact' => 'Party'], ['as_of' => '2026-01-01']);
    expect($this->rowsOf($tb['id'])[2]['errors'][0]['code'])->toBe('code_not_found');
    $inv = $this->previewed('invoices', "Ref,Cust,Date,Qty,Price,Acct\nI-1,B-CUST,2026-03-10,1,10.00,4000\n", ['invoice_ref' => 'Ref', 'contact' => 'Cust', 'issue_date' => 'Date', 'quantity' => 'Qty', 'unit_price' => 'Price', 'account' => 'Acct']);
    expect($this->rowsOf($inv['id'])[2]['errors'][0]['field'])->toBe('contact');

    // A bank account of the other company cannot be the target.
    $betaBank = (string) Str::uuid7();
    $this->inTenant(fn () => DB::table('bank_accounts')->insert(['id' => $betaBank, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'name' => 'Beta bank', 'account_id' => $this->betaAccount, 'currency' => 'USD', 'kind' => 'bank']));
    $this->upload('bank_lines', "Date,Text,Amt\n2026-03-02,x,1.00\n", ['bank_account_id' => $betaBank], by: $this->accountant)->assertStatus(422)->assertJsonValidationErrors('options.bank_account_id');
});
