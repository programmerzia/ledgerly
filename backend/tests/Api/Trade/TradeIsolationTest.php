<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Domain\Trade\InvoiceKind;
use App\Support\Actor;
use App\Support\ActorType;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * RLS separates tenants, not companies (13 §6): ids of the other company are 404 on every route, in either family,
 * and ids inside request bodies are validation errors. Token abilities decide what a client may do.
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->beta = $this->secondCompany();
    $this->both = $this->person('Both Owner', ['Owner']);
    $this->inTenant(fn () => app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($this->both->id, $this->beta->id, 'Owner')));

    $this->b = $this->inTenant(function (): array {
        $actor = new Actor(ActorType::User, $this->f->userId, $this->f->tenantId, $this->beta->id);
        $ids = ['account' => (string) Str::uuid7(), 'contact' => (string) Str::uuid7(), 'supplier' => (string) Str::uuid7(), 'tax' => (string) Str::uuid7(), 'item' => (string) Str::uuid7()];
        DB::table('accounts')->insert(['id' => $ids['account'], 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'code' => '4000', 'name' => 'B Sales', 'account_type' => 'income', 'normal_balance' => 'credit']);
        foreach (['contact' => 'customer', 'supplier' => 'supplier'] as $key => $kind) {
            DB::table('contacts')->insert(['id' => $ids[$key], 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'kind' => $kind, 'code' => 'B-'.$key, 'name' => 'B', 'default_currency' => 'USD']);
        }
        DB::table('tax_codes')->insert(['id' => $ids['tax'], 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'code' => 'BVAT', 'name' => 'B VAT', 'kind' => 'vat']);
        DB::table('items')->insert(['id' => $ids['item'], 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'code' => 'BI', 'name' => 'B item', 'kind' => 'service', 'currency' => 'USD']);

        $line = new InvoiceLineInput('1', accountId: $ids['account'], unitPriceFc: 1000);
        $draft = fn (InvoiceKind $kind, string $contact) => app(CreateInvoiceDraft::class)->handle($actor, new InvoiceDraftInput($this->beta->id, $kind, $contact, new DateTimeImmutable('2026-03-15'), [$line]))->id;
        $ids['invoice'] = $draft(InvoiceKind::SalesInvoice, $ids['contact']);
        $ids['bill'] = $draft(InvoiceKind::PurchaseBill, $ids['supplier']);

        return $ids;
    });
});

it('answers 404 for every route that binds an invoice, bill or item of the other company', function (): void {
    $b = $this->b;
    $this->asPerson($this->both, signing: true);
    $routes = [];
    foreach (['invoice' => 'invoices', 'bill' => 'bills'] as $key => $path) {
        foreach ([['GET', ''], ['PUT', ''], ['POST', '/posting-preview'], ['POST', '/submit'], ['POST', '/approve'], ['POST', '/return'], ['POST', '/void'], ['POST', '/reverse']] as [$method, $suffix]) {
            $routes[] = [$method, "{$path}/{$b[$key]}{$suffix}"];
        }
    }
    foreach ([['GET', ''], ['PUT', ''], ['POST', '/deactivate']] as [$method, $suffix]) {
        $routes[] = [$method, "items/{$b['item']}{$suffix}"];
    }
    foreach ($routes as [$method, $path]) {
        $this->json($method, $this->api($path), [], $this->key())->assertNotFound()->assertJson(['code' => 'not_found']);
    }

    // The same ids under their own company work, so the 404s are about the company and nothing else.
    $this->getJson($this->api("invoices/{$b['invoice']}", $this->beta->id))->assertOk()->assertJsonPath('data.id', $b['invoice']);
    $this->getJson($this->api("bills/{$b['bill']}", $this->beta->id))->assertOk();
    $this->getJson($this->api("items/{$b['item']}", $this->beta->id))->assertOk();
    $this->postJson($this->api("invoices/{$b['invoice']}/posting-preview", $this->beta->id), [], $this->key())->assertOk();

    // A bill is no invoice and an invoice no bill, even inside one company.
    $this->getJson($this->api("bills/{$b['invoice']}", $this->beta->id))->assertNotFound();
    $this->getJson($this->api("invoices/{$b['bill']}", $this->beta->id))->assertNotFound();
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]), $this->both);
    $this->getJson($this->api("bills/{$doc['id']}"))->assertNotFound();
    $this->postJson($this->api("bills/{$doc['id']}/submit"), [], $this->key())->assertNotFound();

    $this->getJson($this->api('invoices'))->assertJsonCount(1, 'data');
    $this->getJson($this->api('bills'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('invoices', $this->beta->id))->assertJsonCount(1, 'data');
    $this->getJson($this->api('items'))->assertJsonCount(0, 'data');
    expect($this->inTenant(fn () => DB::table('invoices')->where('company_id', $this->beta->id)->pluck('status')->unique()->all()))->toBe(['draft']);
});

it('refuses ids of the other company inside request bodies as validation errors', function (): void {
    $b = $this->b;
    $this->asPerson($this->both);
    $own = $this->t->body($this->t->customer, [[1000, '1']]);
    $post = fn (array $body, string $path = 'invoices') => $this->postJson($this->api($path), $body, $this->key())->assertStatus(422);

    $post([...$own, 'contact_id' => $b['contact']])->assertJsonValidationErrors(['contact_id']);
    $body = $own;
    $body['lines'][0]['account_id'] = $b['account'];
    $post($body)->assertJsonValidationErrors(['lines.0.account_id']);
    $body = $own;
    $body['lines'][0]['tax_code_id'] = $b['tax'];
    $post($body)->assertJsonValidationErrors(['lines.0.tax_code_id']);
    $body = $own;
    $body['lines'][0]['item_id'] = $b['item'];
    $post($body)->assertJsonValidationErrors(['lines.0.item_id']);
    $post([...$own, 'kind' => 'credit_note', 'related_invoice_id' => $b['invoice']])->assertJsonValidationErrors(['related_invoice_id']);
    $post([...$this->t->body($this->t->supplier, [[1000, '1', null, null, '5000']]), 'wht_code_id' => $b['tax']], 'bills')->assertJsonValidationErrors(['wht_code_id']);
    $post([...$this->t->body($b['supplier'], [[1000, '1', null, null, '5000']])], 'bills')->assertJsonValidationErrors(['contact_id']);
    $this->postJson($this->api('items'), ['code' => 'X', 'name' => 'X', 'kind' => 'good', 'currency' => 'USD', 'sales_account_id' => $b['account']], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['sales_account_id']);
    $this->postJson($this->api('items'), ['code' => 'X', 'name' => 'X', 'kind' => 'good', 'currency' => 'USD', 'tax_code_id' => $b['tax']], $this->key())
        ->assertStatus(422)->assertJsonValidationErrors(['tax_code_id']);

    // Dimension values of another company are refused like journal lines' are.
    $dim = $this->inTenant(function (): array {
        $d = (string) Str::uuid7();
        $v = (string) Str::uuid7();
        DB::table('dimensions')->insert(['id' => $d, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'code' => 'DEPT', 'name' => 'Dept', 'position' => 1]);
        DB::table('dimension_values')->insert(['id' => $v, 'tenant_id' => $this->f->tenantId, 'company_id' => $this->beta->id, 'dimension_id' => $d, 'code' => 'OPS', 'name' => 'Ops']);

        return [$d, $v];
    });
    $body = $own;
    $body['lines'][0]['dimensions'] = [$dim[0] => $dim[1]];
    $post($body)->assertJsonValidationErrors(['lines.0.dimensions']);
});

it('lets a token with the invoices abilities draft, preview and submit, and nothing beyond its abilities', function (): void {
    $this->asToken($this->newToken(['invoices:read', 'invoices:write', 'invoices:submit']));
    $draft = $this->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[10000, '1', 'VAT10']]), $this->key())->assertCreated()
        ->assertJsonPath('data.can.update', true)->assertJsonPath('data.can.submit', true)->assertJsonPath('data.can.approve', false)->assertJsonPath('data.can.reverse', false);
    $id = $draft->json('data.id');
    $clientId = $draft->json('data.created_by');

    $this->getJson($this->api("invoices/{$id}"))->assertOk();
    $this->getJson($this->api('invoices'))->assertOk()->assertJsonCount(1, 'data');
    $this->postJson($this->api("invoices/{$id}/posting-preview"), [], $this->key())->assertOk()->assertJsonPath('data.valid', true);
    $this->putJson($this->api("invoices/{$id}"), [...$this->t->body($this->t->customer, [[20000, '1', 'VAT10']]), 'version' => 0], $this->key())->assertOk()->assertJsonPath('data.version', 1);
    // No workflow: the token's submit posts directly. Its evidence is the token, not a PIN.
    $this->postJson($this->api("invoices/{$id}/submit"), ['version' => 1], $this->key())->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.number', 'INV-FY2026-00001');
    $audit = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'invoice.submitted')->first());
    expect($audit->actor_type)->toBe('api_client')->and($audit->actor_id)->toBe($clientId);

    // Not its abilities: bills, items, journals; and never approve, return, reverse.
    $this->getJson($this->api('bills'))->assertForbidden();
    $this->postJson($this->api('bills'), $this->t->body($this->t->supplier, [[1000, '1', null, null, '5000']]), $this->key())->assertForbidden();
    $this->getJson($this->api('items'))->assertForbidden();
    $this->postJson($this->api("invoices/{$id}/reverse"), [], $this->key())->assertForbidden();
    $this->postJson($this->api("invoices/{$id}/approve"), [], $this->key())->assertForbidden();

    // Even a wildcard token cannot approve, return or reverse; it can void its own draft.
    $this->workflow('invoice');
    $this->asToken($this->newToken(['*']));
    $pending = $this->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[1000, '1']]), $this->key())->assertCreated()->json('data.id');
    $this->postJson($this->api("invoices/{$pending}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->postJson($this->api("invoices/{$pending}/approve"), [], $this->key())->assertForbidden();
    $this->postJson($this->api("invoices/{$pending}/return"), ['comment' => 'no'], $this->key())->assertForbidden();
    $this->postJson($this->api("invoices/{$id}/reverse"), [], $this->key())->assertForbidden();
    $this->postJson($this->api("invoices/{$pending}/void"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'void');
});

it('gives a read-only token only reads, and a token no access to a company it was not issued for', function (): void {
    $doc = $this->draftDoc('invoices', $this->t->body($this->t->customer, [[1000, '1']]));
    $this->asToken($this->newToken(['invoices:read', 'bills:read', 'items:read']));
    $this->getJson($this->api('invoices'))->assertOk()->assertJsonCount(1, 'data');
    $this->getJson($this->api('bills'))->assertOk();
    $this->getJson($this->api('items'))->assertOk();
    $this->getJson($this->api("invoices/{$doc['id']}"))->assertOk()->assertJsonPath('data.can.update', false)->assertJsonPath('data.can.submit', false);
    $this->postJson($this->api('invoices'), $this->t->body($this->t->customer, [[1000, '1']]), $this->key())->assertForbidden();
    $this->postJson($this->api("invoices/{$doc['id']}/submit"), [], $this->key())->assertForbidden();
    $this->postJson($this->api('items'), ['code' => 'X', 'name' => 'X', 'kind' => 'good', 'currency' => 'USD'], $this->key())->assertForbidden();

    $this->asToken($this->newToken(['*']))->getJson($this->api('invoices', $this->beta->id))->assertStatus(403)->assertJson(['code' => 'company_access_denied']);
    $this->asToken($this->newToken(['items:read', 'items:write']))->postJson($this->api('items'), ['code' => 'TKN', 'name' => 'Token item', 'kind' => 'good', 'currency' => 'USD', 'sales_price' => 500], $this->key())
        ->assertCreated()->assertJsonPath('data.sales_price.amount', 500);
});
