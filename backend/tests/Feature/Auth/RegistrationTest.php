<?php

declare(strict_types=1);

use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/*
 * Sign-up (02_AppFlow §2): one request creates the user, the organisation and the owner
 * membership, signs the user in, and leads to onboarding (no company yet).
 */

beforeEach(function (): void {
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
});

function registration(array $overrides = []): array
{
    return [
        'name' => 'Nadia Rahman', 'email' => 'Nadia@Example.test', 'organisation_name' => 'Rahman & Co',
        'password' => 'Correct-Horse-42', 'password_confirmation' => 'Correct-Horse-42', ...$overrides,
    ];
}

it('creates the organisation and its owner, signs in, and starts without a company', function (): void {
    $this->postJson('/api/v1/auth/register', registration())->assertCreated();

    $me = $this->getJson('/api/v1/me')->assertOk()
        ->assertJsonPath('data.email', 'nadia@example.test')
        ->assertJsonPath('data.tenants.0.name', 'Rahman & Co')
        ->assertJsonPath('data.tenants.0.role', 'owner');
    $tenantId = $me->json('data.tenants.0.id');

    $tenant = DB::table('tenants')->where('id', $tenantId)->first();
    expect($tenant->slug)->toBe('rahman-co')->and($tenant->lifecycle)->toBe('trial');

    $this->getJson('/api/v1/companies')->assertOk()->assertJsonCount(0, 'data');

    app(TenantContext::class)->run($tenantId, function (): void {
        expect(DB::table('audit_events')->pluck('action')->all())->toBe(['organisation.registered']);
    });
    expect(app(TenantContext::class)->id())->toBeNull();
});

it('gives each organisation a unique slug', function (): void {
    $this->postJson('/api/v1/auth/register', registration())->assertCreated();
    $this->postJson('/api/v1/auth/logout')->assertSuccessful();
    $this->postJson('/api/v1/auth/register', registration(['email' => 'other@example.test']))->assertCreated();

    expect(DB::table('tenants')->pluck('slug')->sort()->values()->all())
        ->toHaveCount(2)->each->toStartWith('rahman-co');
});

it('rejects a taken email (any case), weak passwords and missing fields without creating anything', function (): void {
    LedgerFixture::create(slug: 'acme');
    app(TenantContext::class)->clear();

    $this->postJson('/api/v1/auth/register', registration(['email' => 'MAKER@acme.test']))
        ->assertStatus(422)->assertJsonValidationErrors(['email']);
    $this->postJson('/api/v1/auth/register', registration(['password' => 'short', 'password_confirmation' => 'short']))
        ->assertStatus(422)->assertJsonValidationErrors(['password']);
    $this->postJson('/api/v1/auth/register', registration(['organisation_name' => '']))
        ->assertStatus(422)->assertJsonValidationErrors(['organisation_name']);

    expect(DB::table('tenants')->count())->toBe(1)->and(DB::table('users')->count())->toBe(1);
});

it('refuses to register while signed in and limits sign-ups per address', function (): void {
    $this->postJson('/api/v1/auth/register', registration())->assertCreated();
    $this->postJson('/api/v1/auth/register', registration(['email' => 'again@example.test']))->assertStatus(302);
    $this->postJson('/api/v1/auth/logout');

    foreach (range(2, 10) as $i) {
        $this->postJson('/api/v1/auth/register', registration(['email' => "n{$i}@example.test"]));
        $this->postJson('/api/v1/auth/logout');
    }
    $this->postJson('/api/v1/auth/register', registration(['email' => 'eleven@example.test']))->assertStatus(429);
});
