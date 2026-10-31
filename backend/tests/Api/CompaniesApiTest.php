<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\CreateCompany;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\Inputs\CreateCompanyInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Models\Platform\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

beforeEach(function (): void {
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
});

const COMPANY_PAYLOAD = [
    'name' => 'Globex Ltd', 'legal_name' => 'Globex Limited', 'country' => 'GB', 'base_currency' => 'GBP',
    'fiscal_year_start_month' => 4, 'tax_id' => 'GB123', 'timezone' => 'Europe/London',
];

it('creates a company for the org owner', function (): void {
    $f = LedgerFixture::create();
    app(TenantContext::class)->clear();

    $this->actingAs(User::query()->findOrFail($f->userId))
        ->postJson('/api/v1/companies', COMPANY_PAYLOAD)
        ->assertCreated()
        ->assertJsonPath('data.slug', 'globex-ltd')
        ->assertJsonPath('data.base_currency', 'GBP')
        ->assertJsonPath('data.fiscal_year_start_month', 4)
        ->assertJsonPath('data.timezone', 'Europe/London')
        ->assertJsonPath('data.status', 'active')
        ->assertJsonStructure(['data' => ['id', 'name', 'legal_name', 'slug', 'country', 'tax_id']]);
});

it('validates the payload', function (): void {
    $f = LedgerFixture::create();
    app(TenantContext::class)->clear();

    $this->actingAs(User::query()->findOrFail($f->userId))
        ->postJson('/api/v1/companies', ['name' => '', 'country' => 'GBR', 'base_currency' => 'GB', 'fiscal_year_start_month' => 13])
        ->assertStatus(422)
        ->assertJsonValidationErrors(['name', 'country', 'base_currency', 'fiscal_year_start_month']);

    $this->postJson('/api/v1/companies', [...COMPANY_PAYLOAD, 'base_currency' => 'ZZZ'])->assertStatus(422);
});

it('refuses plain members and anonymous callers', function (): void {
    $f = LedgerFixture::create();
    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => 'm', 'email' => 'm@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'member']);
    app(TenantContext::class)->clear();

    $this->postJson('/api/v1/companies', COMPANY_PAYLOAD)->assertStatus(401);
    $this->actingAs(User::query()->findOrFail($id))->postJson('/api/v1/companies', COMPANY_PAYLOAD)->assertStatus(403);
});

it('lists only the companies the user can access', function (): void {
    $f = LedgerFixture::create();
    $second = app(CreateCompany::class)->handle($f->actor, new CreateCompanyInput('Beta Co', 'US', 'USD', 1));
    app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId);

    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => 'm', 'email' => 'm@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $id, 'role' => 'member']);
    app(AssignCompanyRole::class)->handle($f->actor, new CompanyRoleInput($id, $second->id, 'Viewer'));
    app(TenantContext::class)->clear();

    $this->actingAs(User::query()->findOrFail($f->userId))->getJson('/api/v1/companies')
        ->assertOk()->assertJsonCount(2, 'data')
        ->assertJsonPath('data.0.name', 'Acme acme')->assertJsonPath('data.1.name', 'Beta Co');

    $this->actingAs(User::query()->findOrFail($id))->getJson('/api/v1/companies')
        ->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $second->id);
});
