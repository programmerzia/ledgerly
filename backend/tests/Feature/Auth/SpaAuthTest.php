<?php

declare(strict_types=1);

use App\Support\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use PragmaRX\Google2FA\Google2FA;
use Tests\Support\LedgerFixture;

/*
 * SPA authentication (13 §7): Fortify JSON endpoints under /api/v1/auth over Sanctum's stateful
 * session, the /me endpoint and the organisation switch.
 */

const PASSWORD = 'Correct-Horse-42';

/** A tenant whose owner can sign in with PASSWORD. */
function signInFixture(string $slug = 'acme'): LedgerFixture
{
    $f = LedgerFixture::create(slug: $slug);
    app(TenantContext::class)->clear();
    DB::table('users')->where('id', $f->userId)->update(['password' => Hash::make(PASSWORD)]);

    return $f;
}

beforeEach(function (): void {
    // Requests from the SPA origin are stateful (session cookie + CSRF).
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
});

it('signs in with email and password and lists the organisations', function (): void {
    $f = signInFixture();

    $this->postJson('/api/v1/auth/login', ['email' => 'MAKER@acme.test', 'password' => PASSWORD])->assertSuccessful();

    $this->getJson('/api/v1/me')->assertOk()
        ->assertJsonPath('data.email', 'maker@acme.test')
        ->assertJsonPath('data.two_factor_enabled', false)
        ->assertJsonPath('data.tenants.0.id', $f->tenantId)
        ->assertJsonPath('data.tenants.0.role', 'owner');
});

it('rejects a wrong password and throttles repeated attempts', function (): void {
    signInFixture();

    $this->postJson('/api/v1/auth/login', ['email' => 'maker@acme.test', 'password' => 'nope'])->assertStatus(422);
    foreach (range(1, 4) as $_) {
        $this->postJson('/api/v1/auth/login', ['email' => 'maker@acme.test', 'password' => 'nope']);
    }
    $this->postJson('/api/v1/auth/login', ['email' => 'maker@acme.test', 'password' => PASSWORD])->assertStatus(429);
    $this->getJson('/api/v1/me')->assertStatus(401);
});

it('requires the TOTP code when two-factor authentication is on', function (): void {
    $f = signInFixture();
    $totp = new Google2FA;
    $secret = $totp->generateSecretKey();
    DB::table('users')->where('id', $f->userId)->update([
        'two_factor_secret' => encrypt($secret), 'two_factor_confirmed_at' => now(),
        'two_factor_recovery_codes' => encrypt(json_encode(['recovery-one-1234'])),
    ]);

    $this->postJson('/api/v1/auth/login', ['email' => 'maker@acme.test', 'password' => PASSWORD])
        ->assertOk()->assertJson(['two_factor' => true]);
    $this->getJson('/api/v1/me')->assertStatus(401);

    $this->postJson('/api/v1/auth/two-factor-challenge', ['code' => '000000'])->assertStatus(422);
    $this->postJson('/api/v1/auth/two-factor-challenge', ['code' => $totp->getCurrentOtp($secret)])->assertSuccessful();
    $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.two_factor_enabled', true);
});

it('switches organisation with a new session id and refuses organisations the user is not in', function (): void {
    $a = signInFixture('alpha');
    $b = LedgerFixture::create(slug: 'beta');
    $outsider = LedgerFixture::create(slug: 'gamma');
    app(TenantContext::class)->clear();
    DB::table('tenant_users')->insert(['tenant_id' => $b->tenantId, 'user_id' => $a->userId, 'role' => 'admin']);

    $this->postJson('/api/v1/auth/login', ['email' => 'maker@alpha.test', 'password' => PASSWORD])->assertSuccessful();
    $before = session()->getId();

    $this->putJson('/api/v1/session/tenant', ['tenant_id' => $b->tenantId])->assertOk()
        ->assertJsonPath('data.tenants.1.current', true); // alpha, beta (sorted by name)
    expect(session()->getId())->not->toBe($before)
        ->and(session('current_tenant_id'))->toBe($b->tenantId);

    $this->putJson('/api/v1/session/tenant', ['tenant_id' => $outsider->tenantId])
        ->assertStatus(403)->assertJson(['code' => 'tenant_access_denied']);
    expect(session('current_tenant_id'))->toBe($b->tenantId);
});

it('signs out', function (): void {
    signInFixture();
    $this->postJson('/api/v1/auth/login', ['email' => 'maker@acme.test', 'password' => PASSWORD])->assertSuccessful();

    $this->postJson('/api/v1/auth/logout')->assertSuccessful();
    $this->getJson('/api/v1/me')->assertStatus(401);
});

it('keeps one account per email address, ignoring case', function (): void {
    signInFixture();

    expect(fn () => DB::table('users')->insert([
        'id' => (string) Str::uuid7(), 'name' => 'Dup', 'email' => 'Maker@ACME.test', 'password' => 'x',
    ]))->toThrow(UniqueConstraintViolationException::class);
});
