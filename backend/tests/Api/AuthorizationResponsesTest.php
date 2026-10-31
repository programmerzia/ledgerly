<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Models\Platform\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/* `can` hints in responses (13 §7) and problem+json for denied, unknown and unauthenticated requests. */

beforeEach(function (): void {
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
    $this->f = LedgerFixture::create();
    app(SeedCompanyRoles::class)->handle($this->f->actor, $this->f->companyId);
    app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($this->f->userId, $this->f->companyId, 'Owner'));

    $id = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $id, 'name' => 'Clerk', 'email' => 'clerk@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $this->f->tenantId, 'user_id' => $id, 'role' => 'member']);
    app(AssignCompanyRole::class)->handle($this->f->actor, new CompanyRoleInput($id, $this->f->companyId, 'Accountant'));
    $this->clerk = User::query()->findOrFail($id);
    $this->owner = User::query()->findOrFail($this->f->userId);
    app(TenantContext::class)->clear();
});

it('tells the SPA what each user may do', function (): void {
    $this->actingAs($this->owner)->getJson('/api/v1/companies')->assertOk()
        ->assertJsonPath('data.0.can', ['open' => true, 'manage_settings' => true]);
    $this->actingAs($this->owner)->getJson('/api/v1/me')
        ->assertJsonPath('data.tenants.0.can', ['manage_members' => true, 'create_companies' => true]);

    $this->actingAs($this->clerk)->getJson('/api/v1/companies')->assertOk()
        ->assertJsonPath('data.0.can', ['open' => true, 'manage_settings' => false]);
    $this->actingAs($this->clerk)->getJson('/api/v1/me')
        ->assertJsonPath('data.tenants.0.can', ['manage_members' => false, 'create_companies' => false]);
});

it('answers a denied policy with problem+json 403', function (): void {
    $this->actingAs($this->clerk)->getJson('/api/v1/invitations')
        ->assertStatus(403)->assertHeader('Content-Type', 'application/problem+json')
        ->assertJson(['code' => 'forbidden', 'status' => 403]);
    $this->actingAs($this->clerk)->postJson('/api/v1/companies', [])->assertStatus(403)->assertJson(['code' => 'forbidden']);
});

it('answers unknown, malformed and other tenants\' ids with the same 404', function (): void {
    $other = LedgerFixture::create(slug: 'beta');
    $foreign = (string) Str::uuid7();
    DB::table('invitations')->insert([
        'id' => $foreign, 'tenant_id' => $other->tenantId, 'email' => 'x@beta.test', 'invited_by' => $other->userId,
        'token_hash' => hash('sha256', 'beta-token'), 'expires_at' => now()->addDay(),
    ]);
    app(TenantContext::class)->clear();

    foreach ([$foreign, (string) Str::uuid7(), 'not-a-uuid'] as $id) {
        $this->actingAs($this->owner)->deleteJson("/api/v1/invitations/{$id}")
            ->assertStatus(404)->assertHeader('Content-Type', 'application/problem+json')->assertJson(['code' => 'not_found']);
    }
    app(TenantContext::class)->run($other->tenantId, fn () => expect(DB::table('invitations')->whereNull('revoked_at')->count())->toBe(1));
});

it('answers a missing session with problem+json 401', function (): void {
    $this->getJson('/api/v1/companies')->assertStatus(401)->assertJson(['code' => 'unauthenticated']);
});
