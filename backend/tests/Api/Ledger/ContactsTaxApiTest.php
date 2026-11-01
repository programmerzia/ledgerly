<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/*
 * Contacts, tax codes with dated rates and tax groups over HTTP (plan 2.10). Real seeded roles: Finance Manager
 * manages everything, Accountant manages contacts but only reads tax, Sales Assistant manages customers only.
 */

beforeEach(function (): void {
    $this->setUpWorld();
    $this->manager = $this->person('Fay Manager', ['Finance Manager']);
    $this->accountant = $this->person('Ann Accountant', ['Accountant']);
    $this->sales = $this->person('Sam Sales', ['Sales Assistant']);
    $this->viewer = $this->person('Vic Viewer', ['Viewer']);
});

function customer(array $over = []): array
{
    return ['kind' => 'customer', 'code' => 'C001', 'name' => 'Acme Ltd', 'default_currency' => 'USD', 'payment_terms_days' => 30, ...$over];
}

function vatBody(array $over = []): array
{
    return ['code' => 'VAT5', 'name' => 'VAT 5%', 'kind' => 'vat', 'rate' => '0.05', 'effective_from' => '2026-01-01', ...$over];
}

it('creates, shows, updates, lists and deactivates a contact', function (): void {
    $ar = $this->f->account('1100');
    $created = $this->asPerson($this->accountant)->postJson($this->api('contacts'), customer([
        'email' => 'ap@acme.test', 'credit_limit' => ['amount' => 500000, 'currency' => 'USD'], 'ar_account_id' => $ar,
        'billing_address' => ['line1' => '1 Main St', 'city' => 'Dhaka'], 'default_branch' => 'HQ',
    ]), $this->key())->assertCreated()
        ->assertJsonPath('data.code', 'C001')->assertJsonPath('data.version', 0)->assertJsonPath('data.is_active', true)
        ->assertJsonPath('data.credit_limit', ['amount' => 500000, 'currency' => 'USD'])
        ->assertJsonPath('data.billing_address.city', 'Dhaka')->assertJsonPath('data.can.update', true);
    $id = $created->json('data.id');
    expect($created->json())->not->toHaveKey('data.balance');

    $this->getJson($this->api("contacts/{$id}"))->assertOk()->assertJsonPath('data.ar_account_id', $ar)->assertJsonPath('data.default_dims', []);
    $this->putJson($this->api("contacts/{$id}"), customer(['name' => 'Acme Limited', 'version' => 0]), $this->key())
        ->assertOk()->assertJsonPath('data.name', 'Acme Limited')->assertJsonPath('data.version', 1)->assertJsonPath('data.credit_limit', null);
    $this->putJson($this->api("contacts/{$id}"), customer(['version' => 0]), $this->key())->assertStatus(409)->assertJson(['code' => 'version_conflict', 'server_version' => 1]);
    $this->postJson($this->api('contacts'), customer(['name' => 'Dup']), $this->key())->assertStatus(422)->assertJson(['code' => 'contact_code_taken']);

    $this->postJson($this->api('contacts'), customer(['code' => 'S001', 'name' => 'Bolt Supplies', 'kind' => 'supplier']), $this->key())->assertCreated();
    $this->postJson($this->api('contacts'), customer(['code' => 'B001', 'name' => 'Both Co', 'kind' => 'both']), $this->key())->assertCreated();

    $this->asPerson($this->viewer);
    $this->getJson($this->api('contacts'))->assertOk()->assertJsonCount(3, 'data')->assertJsonPath('data.0.code', 'B001')->assertJsonPath('data.0.can.update', false);
    $this->getJson($this->api('contacts?kind=customer'))->assertJsonCount(2, 'data'); // customers and "both"
    $this->getJson($this->api('contacts?kind=supplier'))->assertJsonCount(2, 'data');
    $this->getJson($this->api('contacts?search=bolt'))->assertJsonCount(1, 'data')->assertJsonPath('data.0.code', 'S001');
    $this->getJson($this->api('contacts?search=C00'))->assertJsonCount(1, 'data');
    $this->getJson($this->api('contacts?kind=vendor'))->assertStatus(422);
    $first = $this->getJson($this->api('contacts?limit=2'))->assertJsonCount(2, 'data');
    $this->getJson($this->api('contacts?limit=2&cursor='.$first->json('meta.next_cursor')))->assertJsonCount(1, 'data')->assertJsonPath('data.0.code', 'S001');

    $this->asPerson($this->accountant)->postJson($this->api("contacts/{$id}/deactivate"), ['version' => 1], $this->key())
        ->assertOk()->assertJsonPath('data.is_active', false)->assertJsonPath('data.version', 2)->assertJsonPath('data.can.deactivate', false);
    $this->getJson($this->api('contacts?active=false'))->assertJsonCount(1, 'data');
    $this->postJson($this->api("contacts/{$id}/deactivate"), ['version' => 2], $this->key())->assertForbidden();
    expect($this->inTenant(fn () => DB::table('audit_events')->whereIn('action', ['contact.created', 'contact.updated', 'contact.deactivated'])->count()))->toBe(5);
});

it('lets a Sales Assistant manage customers only', function (): void {
    $this->asPerson($this->sales);
    $id = $this->postJson($this->api('contacts'), customer(), $this->key())->assertCreated()->json('data.id');
    $this->postJson($this->api('contacts'), customer(['code' => 'S1', 'kind' => 'supplier']), $this->key())->assertForbidden()->assertJson(['code' => 'forbidden']);
    $this->postJson($this->api('contacts'), customer(['code' => 'B1', 'kind' => 'both']), $this->key())->assertForbidden();
    // A customer cannot be turned into a supplier either.
    $this->putJson($this->api("contacts/{$id}"), customer(['kind' => 'supplier', 'version' => 0]), $this->key())->assertForbidden();
    $this->putJson($this->api("contacts/{$id}"), customer(['name' => 'Renamed', 'version' => 0]), $this->key())->assertOk();

    $supplier = $this->asPerson($this->manager)->postJson($this->api('contacts'), customer(['code' => 'S1', 'kind' => 'supplier']), $this->key())->assertCreated()->json('data.id');
    $this->asPerson($this->sales);
    $this->getJson($this->api("contacts/{$supplier}"))->assertOk()->assertJsonPath('data.can.update', false);
    $this->putJson($this->api("contacts/{$supplier}"), customer(['code' => 'S1', 'kind' => 'supplier', 'version' => 0]), $this->key())->assertForbidden();
    $this->postJson($this->api("contacts/{$supplier}/deactivate"), ['version' => 0], $this->key())->assertForbidden();
    $this->asPerson($this->viewer)->postJson($this->api('contacts'), customer(['code' => 'V']), $this->key())->assertForbidden();
});

it('checks the accounts, tax codes and dimensions a contact refers to', function (): void {
    $this->asPerson($this->manager);
    $wht = $this->postJson($this->api('tax-codes'), vatBody(['code' => 'WHT10', 'name' => 'WHT 10%', 'kind' => 'wht', 'rate' => '0.10']), $this->key())->assertCreated()->json('data.id');
    $vat = $this->postJson($this->api('tax-codes'), vatBody(), $this->key())->assertCreated()->json('data.id');

    $this->postJson($this->api('contacts'), customer(['ap_account_id' => $this->f->account('2000')]), $this->key())->assertStatus(422)->assertJson(['code' => 'contact_account_invalid']);
    $this->postJson($this->api('contacts'), customer(['ar_account_id' => $this->f->account('4000')]), $this->key())->assertStatus(422)->assertJson(['code' => 'contact_account_invalid']);
    $this->postJson($this->api('contacts'), customer(['kind' => 'supplier', 'ar_account_id' => $this->f->account('1100')]), $this->key())->assertStatus(422)->assertJson(['code' => 'contact_account_invalid']);
    $this->postJson($this->api('contacts'), customer(['wht_code_id' => $vat]), $this->key())->assertStatus(422)->assertJson(['code' => 'contact_tax_code_invalid']);
    $this->postJson($this->api('contacts'), customer(['default_currency' => 'ZZZ']), $this->key())->assertStatus(422)->assertJsonValidationErrors(['default_currency']);
    $this->postJson($this->api('contacts'), customer(['credit_limit' => ['amount' => 5, 'currency' => 'EUR']]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['credit_limit.currency']);
    $this->postJson($this->api('contacts'), customer(['default_dims' => [(string) Str::uuid7() => (string) Str::uuid7()]]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['default_dims']);
    $this->postJson($this->api('contacts'), customer(['kind' => 'supplier', 'ap_account_id' => $this->f->account('2000'), 'wht_code_id' => $wht, 'default_tax_code_id' => $vat]), $this->key())
        ->assertCreated()->assertJsonPath('data.wht_code_id', $wht);

    $dim = $this->postJson($this->api('dimensions'), ['code' => 'REGION', 'name' => 'Region'], $this->key())->json('data.id');
    $value = $this->postJson($this->api("dimensions/{$dim}/values"), ['code' => 'N', 'name' => 'North'], $this->key())->json('data.id');
    $this->postJson($this->api('contacts'), customer(['code' => 'C2', 'default_dims' => [$dim => $value]]), $this->key())->assertCreated()->assertJsonPath("data.default_dims.{$dim}", $value);

    // A withholding code that contacts use stays one.
    $this->putJson($this->api("tax-codes/{$wht}"), ['name' => 'WHT', 'kind' => 'vat', 'version' => 0], $this->key())->assertStatus(422)->assertJson(['code' => 'tax_code_in_use']);
});

it('creates tax codes with a first rate and adds dated rates without overlap', function (): void {
    $this->asPerson($this->manager);
    $created = $this->postJson($this->api('tax-codes'), vatBody(['collect_account_id' => $this->f->account('2000'), 'is_recoverable' => true]), $this->key())
        ->assertCreated()->assertJsonPath('data.rate', '0.050000')->assertJsonPath('data.rates.0.effective_from', '2026-01-01')
        ->assertJsonPath('data.rates.0.effective_to', null)->assertJsonPath('data.is_recoverable', true)->assertJsonPath('data.version', 0);
    $id = $created->json('data.id');
    $this->postJson($this->api('tax-codes'), vatBody(), $this->key())->assertStatus(422)->assertJson(['code' => 'tax_code_taken']);
    $this->postJson($this->api('tax-codes'), vatBody(['code' => 'X', 'rate' => 0.05]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['rate']);
    $this->postJson($this->api('tax-codes'), vatBody(['code' => 'X', 'rate' => '5']), $this->key())->assertStatus(422)->assertJsonValidationErrors(['rate']);
    $this->postJson($this->api('tax-codes'), vatBody(['code' => 'X', 'effective_from' => null]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['effective_from']);
    $this->postJson($this->api('tax-codes'), vatBody(['code' => 'X', 'kind' => 'other']), $this->key())->assertStatus(422)->assertJsonValidationErrors(['kind']);
    $this->postJson($this->api('tax-codes'), ['code' => 'NORATE', 'name' => 'No rate yet', 'kind' => 'exempt'], $this->key())->assertCreated()->assertJsonPath('data.rate', null)->assertJsonCount(0, 'data.rates');

    // A new open-ended rate closes the previous open-ended one the day before.
    $this->postJson($this->api("tax-codes/{$id}/rates"), ['rate' => '0.075', 'effective_from' => '2026-07-01', 'version' => 0], $this->key())
        ->assertCreated()->assertJsonPath('data.version', 1)->assertJsonCount(2, 'data.rates')
        ->assertJsonPath('data.rates.0.effective_to', '2026-06-30')->assertJsonPath('data.rates.1.rate', '0.075000')->assertJsonPath('data.rates.1.effective_to', null);
    // Overlaps, or an end date that would cut the open rate short, are refused.
    $this->postJson($this->api("tax-codes/{$id}/rates"), ['rate' => '0.1', 'effective_from' => '2026-03-01', 'version' => 1], $this->key())->assertStatus(422)->assertJson(['code' => 'tax_rate_overlap']);
    $this->postJson($this->api("tax-codes/{$id}/rates"), ['rate' => '0.1', 'effective_from' => '2026-09-01', 'effective_to' => '2026-12-31', 'version' => 1], $this->key())->assertStatus(422)->assertJson(['code' => 'tax_rate_overlap']);
    $this->postJson($this->api("tax-codes/{$id}/rates"), ['rate' => '0.1', 'effective_from' => '2026-09-01', 'effective_to' => '2026-08-01', 'version' => 1], $this->key())->assertStatus(422)->assertJsonValidationErrors(['effective_to']);
    $this->postJson($this->api("tax-codes/{$id}/rates"), ['rate' => '1.5', 'effective_from' => '2027-01-01', 'version' => 1], $this->key())->assertStatus(422)->assertJsonValidationErrors(['rate']);
    $this->postJson($this->api("tax-codes/{$id}/rates"), ['rate' => '0.1', 'effective_from' => '2027-01-01', 'version' => 0], $this->key())->assertStatus(409);
    // A rate in the past fills the gap before the first one.
    $this->postJson($this->api("tax-codes/{$id}/rates"), ['rate' => '0.04', 'effective_from' => '2025-01-01', 'effective_to' => '2025-12-31', 'version' => 1], $this->key())
        ->assertCreated()->assertJsonCount(3, 'data.rates')->assertJsonPath('data.rates.0.rate', '0.040000');

    $this->putJson($this->api("tax-codes/{$id}"), ['name' => 'Standard VAT', 'kind' => 'vat', 'version' => 2], $this->key())
        ->assertOk()->assertJsonPath('data.name', 'Standard VAT')->assertJsonPath('data.version', 3)->assertJsonCount(3, 'data.rates');
    $this->putJson($this->api("tax-codes/{$id}"), ['code' => 'NEW', 'name' => 'x', 'kind' => 'vat', 'version' => 3], $this->key())->assertStatus(422)->assertJsonValidationErrors(['code']);
    $this->postJson($this->api("tax-codes/{$id}/deactivate"), ['version' => 3], $this->key())->assertOk()->assertJsonPath('data.is_active', false)->assertJsonPath('data.can.update', true);
    $this->postJson($this->api("tax-codes/{$id}/deactivate"), ['version' => 4], $this->key())->assertForbidden();

    $this->getJson($this->api('tax-codes'))->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.code', 'NORATE')->assertJsonPath('data.1.rate', '0.050000'); // the clock is frozen at 2026-03-15, before the 0.075 rate
    $this->getJson($this->api('tax-codes?active=false'))->assertJsonCount(1, 'data');
    $this->getJson($this->api('tax-codes?kind=exempt'))->assertJsonCount(1, 'data');
    $this->getJson($this->api('tax-codes?kind=bogus'))->assertStatus(422);
});

it('keeps the database from holding overlapping rates', function (): void {
    $this->asPerson($this->manager);
    $id = $this->postJson($this->api('tax-codes'), vatBody(), $this->key())->json('data.id');
    $insert = fn () => $this->inTenant(fn () => DB::table('tax_rates')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'company_id' => $this->f->companyId, 'tax_code_id' => $id,
        'rate' => '0.02', 'effective_from' => '2026-06-01', 'effective_to' => '2026-06-30',
    ]));
    expect($insert)->toThrow(QueryException::class);
});

it('builds tax groups in sequence and validates their members', function (): void {
    $this->asPerson($this->manager);
    $state = $this->postJson($this->api('tax-codes'), vatBody(['code' => 'STATE', 'rate' => '0.10']), $this->key())->json('data.id');
    $city = $this->postJson($this->api('tax-codes'), vatBody(['code' => 'CITY', 'rate' => '0.05']), $this->key())->json('data.id');
    $wht = $this->postJson($this->api('tax-codes'), vatBody(['code' => 'WHT', 'kind' => 'wht']), $this->key())->json('data.id');

    $body = ['code' => 'STATE-CITY', 'name' => 'State and city', 'items' => [['tax_code_id' => $state], ['tax_code_id' => $city, 'compound' => true]]];
    $created = $this->postJson($this->api('tax-groups'), $body, $this->key())->assertCreated()
        ->assertJsonPath('data.items.0', ['tax_code_id' => $state, 'sequence' => 1, 'compound' => false])
        ->assertJsonPath('data.items.1', ['tax_code_id' => $city, 'sequence' => 2, 'compound' => true])->assertJsonPath('data.version', 0);
    $id = $created->json('data.id');

    $this->postJson($this->api('tax-groups'), $body, $this->key())->assertStatus(422)->assertJson(['code' => 'tax_group_code_taken']);
    $this->postJson($this->api('tax-groups'), [...$body, 'code' => 'G2', 'items' => []], $this->key())->assertStatus(422)->assertJsonValidationErrors(['items']);
    $this->postJson($this->api('tax-groups'), [...$body, 'code' => 'G2', 'items' => [['tax_code_id' => $state], ['tax_code_id' => $state]]], $this->key())->assertStatus(422)->assertJson(['code' => 'tax_group_duplicate_code']);
    $this->postJson($this->api('tax-groups'), [...$body, 'code' => 'G2', 'items' => [['tax_code_id' => $state, 'compound' => true]]], $this->key())->assertStatus(422)->assertJson(['code' => 'tax_group_first_compound']);
    $this->postJson($this->api('tax-groups'), [...$body, 'code' => 'G2', 'items' => [['tax_code_id' => $wht]]], $this->key())->assertStatus(422)->assertJson(['code' => 'tax_group_code_invalid']);
    $this->postJson($this->api('tax-groups'), [...$body, 'code' => 'G2', 'items' => [['tax_code_id' => (string) Str::uuid7()]]], $this->key())->assertStatus(422)->assertJsonValidationErrors(['items.0.tax_code_id']);

    $this->putJson($this->api("tax-groups/{$id}"), ['name' => 'Reordered', 'items' => [['tax_code_id' => $city], ['tax_code_id' => $state, 'compound' => true]], 'version' => 0], $this->key())
        ->assertOk()->assertJsonPath('data.name', 'Reordered')->assertJsonPath('data.items.0.tax_code_id', $city)->assertJsonPath('data.version', 1);
    $this->getJson($this->api('tax-groups'))->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.items.1.tax_code_id', $state);
    $this->postJson($this->api("tax-groups/{$id}/deactivate"), ['version' => 1], $this->key())->assertOk()->assertJsonPath('data.is_active', false);
    $this->getJson($this->api('tax-groups?active=true'))->assertJsonCount(0, 'data');
});

it('lets people without tax.manage read tax set-up but not change it', function (): void {
    $this->asPerson($this->manager);
    $id = $this->postJson($this->api('tax-codes'), vatBody(), $this->key())->json('data.id');

    foreach ([$this->accountant, $this->viewer, $this->sales] as $who) {
        $this->asPerson($who);
        if ($who !== $this->sales) {
            $this->getJson($this->api('tax-codes'))->assertOk()->assertJsonPath('data.0.can.update', false);
            $this->getJson($this->api('tax-groups'))->assertOk();
        }
        $this->postJson($this->api('tax-codes'), vatBody(['code' => 'X']), $this->key())->assertForbidden();
        $this->putJson($this->api("tax-codes/{$id}"), ['name' => 'x', 'kind' => 'vat', 'version' => 0], $this->key())->assertForbidden();
        $this->postJson($this->api("tax-codes/{$id}/rates"), ['rate' => '0.1', 'effective_from' => '2027-01-01', 'version' => 0], $this->key())->assertForbidden();
        $this->postJson($this->api('tax-groups'), ['code' => 'G', 'name' => 'g', 'items' => [['tax_code_id' => $id]]], $this->key())->assertForbidden();
    }
});

it('gives tokens contacts:read|write and tax:read only', function (): void {
    $this->asPerson($this->manager);
    $tax = $this->postJson($this->api('tax-codes'), vatBody(), $this->key())->json('data.id');

    $this->asToken($this->newToken(['contacts:read', 'contacts:write', 'tax:read']));
    $id = $this->postJson($this->api('contacts'), customer(), $this->key())->assertCreated()->json('data.id');
    $this->postJson($this->api('contacts'), customer(['code' => 'S1', 'kind' => 'supplier']), $this->key())->assertCreated();
    $this->putJson($this->api("contacts/{$id}"), customer(['name' => 'Via API', 'version' => 0]), $this->key())->assertOk();
    $this->getJson($this->api('contacts'))->assertOk()->assertJsonCount(2, 'data');
    $this->getJson($this->api('tax-codes'))->assertOk()->assertJsonPath('data.0.can.update', false);
    $this->getJson($this->api('tax-groups'))->assertOk();
    $this->postJson($this->api('tax-codes'), vatBody(['code' => 'X']), $this->key())->assertForbidden();
    $this->postJson($this->api("tax-codes/{$tax}/rates"), ['rate' => '0.1', 'effective_from' => '2027-01-01', 'version' => 0], $this->key())->assertForbidden();
    $this->postJson($this->api('tax-groups'), ['code' => 'G', 'name' => 'g', 'items' => [['tax_code_id' => $tax]]], $this->key())->assertForbidden();

    $this->asToken($this->newToken(['contacts:read', 'tax:read']));
    $this->getJson($this->api('contacts'))->assertOk();
    $this->postJson($this->api('contacts'), customer(['code' => 'C9']), $this->key())->assertForbidden();
    $this->asToken($this->newToken(['accounts:read']));
    $this->getJson($this->api('contacts'))->assertForbidden();
    $this->getJson($this->api('tax-codes'))->assertForbidden();
    $this->asToken($this->newToken(['*']));
    $this->postJson($this->api('tax-codes'), vatBody(['code' => 'X']), $this->key())->assertForbidden(); // even a wildcard token never changes tax set-up
});

it('treats the other company\'s contacts, tax codes and groups as not found and refuses their ids in bodies', function (): void {
    $beta = $this->secondCompany();
    $both = $this->person('Both Owner', ['Owner']);
    $this->inTenant(fn () => app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($both->id, $beta->id, 'Owner')));

    $this->asPerson($both);
    $contactB = $this->postJson($this->api('contacts', $beta->id), customer(), $this->key())->assertCreated()->json('data.id');
    $codeB = $this->postJson($this->api('tax-codes', $beta->id), vatBody(), $this->key())->assertCreated()->json('data.id');
    $groupB = $this->postJson($this->api('tax-groups', $beta->id), ['code' => 'G', 'name' => 'g', 'items' => [['tax_code_id' => $codeB]]], $this->key())->assertCreated()->json('data.id');

    $routes = [
        ['GET', "contacts/{$contactB}"], ['PUT', "contacts/{$contactB}"], ['POST', "contacts/{$contactB}/deactivate"],
        ['PUT', "tax-codes/{$codeB}"], ['POST', "tax-codes/{$codeB}/rates"], ['POST', "tax-codes/{$codeB}/deactivate"],
        ['PUT', "tax-groups/{$groupB}"], ['POST', "tax-groups/{$groupB}/deactivate"],
    ];
    foreach ($routes as [$method, $path]) {
        $this->json($method, $this->api($path), [], $this->key())->assertNotFound()->assertJson(['code' => 'not_found']);
    }
    $this->getJson($this->api("contacts/{$contactB}", $beta->id))->assertOk();

    $this->postJson($this->api('contacts'), customer(['wht_code_id' => $codeB]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['wht_code_id']);
    $this->postJson($this->api('contacts'), customer(['default_tax_code_id' => $codeB]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['default_tax_code_id']);
    $this->postJson($this->api('tax-groups'), ['code' => 'G', 'name' => 'g', 'items' => [['tax_code_id' => $codeB]]], $this->key())->assertStatus(422)->assertJsonValidationErrors(['items.0.tax_code_id']);
    $betaAccount = $this->postJson($this->api('accounts', $beta->id), ['code' => '1100', 'name' => 'AR', 'account_type' => 'asset', 'normal_balance' => 'debit', 'control_type' => 'ar'], $this->key())->assertCreated()->json('data.id');
    $this->postJson($this->api('tax-codes'), vatBody(['collect_account_id' => $betaAccount]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['collect_account_id']);
    $this->postJson($this->api('contacts'), customer(['ar_account_id' => $betaAccount]), $this->key())->assertStatus(422)->assertJsonValidationErrors(['ar_account_id']);

    $this->getJson($this->api('contacts'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('tax-codes'))->assertJsonCount(0, 'data');
    $this->getJson($this->api('tax-groups'))->assertJsonCount(0, 'data');
    expect($this->inTenant(fn () => DB::table('contacts')->where('id', $contactB)->value('lock_version')))->toBe(0);
});

it('replays an idempotent create with the same contact', function (): void {
    $this->asPerson($this->manager);
    $key = $this->key();
    $first = $this->postJson($this->api('contacts'), customer(), $key)->assertCreated();
    $second = $this->postJson($this->api('contacts'), customer(), $key)->assertCreated();
    expect($second->json('data.id'))->toBe($first->json('data.id'));
    expect($this->inTenant(fn () => DB::table('contacts')->count()))->toBe(1);
});
