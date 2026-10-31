<?php

declare(strict_types=1);

use App\Http\Support\RequestActor;
use App\Models\Platform\User;
use App\Support\Signing\SigningGrants;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use Tests\Support\LedgerFixture;

/*
 * Signing PIN (ADR-0004, 13 §10): set with the password, verify for a session-bound 10-minute
 * grant, three failures lock for 15 minutes, every attempt leaves evidence that survives the error.
 */

const PASSWORD = 'Correct-Horse-42';

beforeEach(function (): void {
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
    // Grants are bound to the session id. A browser sends the session cookie back on every request;
    // the test client only does so for JSON requests with withCredentials(), so pin one id too.
    $this->withCredentials()->withCookie((string) config('session.cookie'), Str::random(40));
    $this->f = LedgerFixture::create();
    app(TenantContext::class)->clear();
    DB::table('users')->where('id', $this->f->userId)->update(['password' => Hash::make(PASSWORD)]);
    $this->user = User::query()->findOrFail($this->f->userId);
});

function signingEvents(LedgerFixture $f): array
{
    return app(TenantContext::class)->run($f->tenantId, fn () => DB::table('signing_events')->orderBy('occurred_at')->pluck('kind')->all());
}

function setPin(User $user, string $pin = '246810'): TestResponse
{
    return test()->actingAs($user)->putJson('/api/v1/signing/pin', ['current_password' => PASSWORD, 'pin' => $pin]);
}

it('sets the PIN with the password, hashed with argon2id, and refuses weak PINs or a wrong password', function (): void {
    setPin($this->user)->assertOk()->assertJsonPath('data.signing_pin_set', true);
    expect(DB::table('users')->where('id', $this->user->id)->value('signing_pin_hash'))->toStartWith('$argon2id$')
        ->and(signingEvents($this->f))->toBe(['pin_changed']);
    // A real request loads the user afresh; actingAs() keeps the instance from before the PIN was set.
    $this->actingAs(User::query()->findOrFail($this->user->id))->getJson('/api/v1/me')->assertJsonPath('data.signing_pin_set', true);

    setPin($this->user, '123456')->assertStatus(422)->assertJson(['code' => 'pin_policy'])->assertJsonPath('violations.0.code', 'pin_sequential');
    $this->actingAs($this->user)->putJson('/api/v1/signing/pin', ['current_password' => 'wrong', 'pin' => '246810'])
        ->assertStatus(422)->assertJsonValidationErrors(['current_password']);
});

it('grants signing for this session only after the right PIN, and revokes on request', function (): void {
    setPin($this->user)->assertOk();

    $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '246810'])
        ->assertOk()->assertJsonPath('data.granted', true);
    $session = session()->getId();
    expect(app(SigningGrants::class)->has($this->user->id, $session))->toBeTrue()
        ->and(app(SigningGrants::class)->has($this->user->id, 'another-session'))->toBeFalse();

    $request = Request::create('/api/v1/x');
    $request->setUserResolver(fn () => $this->user);
    $request->setLaravelSession(session()->driver());
    expect(app(TenantContext::class)->run($this->f->tenantId, fn () => RequestActor::user($request)->hasSigningGrant))->toBeTrue();

    $this->actingAs($this->user)->deleteJson('/api/v1/signing/grant')->assertOk();
    expect(app(SigningGrants::class)->has($this->user->id, $session))->toBeFalse();
});

it('locks signing after three wrong PINs, keeps the evidence, and clears the lock after 15 minutes', function (): void {
    setPin($this->user)->assertOk();

    foreach ([1, 2] as $_) {
        $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '000001'])->assertStatus(403)->assertJson(['code' => 'signing_failed']);
    }
    $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '000001'])->assertStatus(423)->assertJson(['code' => 'signing_locked']);
    // Even the right PIN is refused while locked, and does not count as a failure.
    $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '246810'])->assertStatus(423);

    expect(signingEvents($this->f))->toBe(['pin_changed', 'failure', 'failure', 'lockout'])
        ->and(app(TenantContext::class)->run($this->f->tenantId, fn () => DB::table('audit_events')->where('action', 'signing.failed')->count()))->toBe(3)
        ->and(app(SigningGrants::class)->has($this->user->id, session()->getId()))->toBeFalse();

    $this->clock->advance('+16 minutes');
    $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '246810'])->assertOk();
    expect(DB::table('users')->where('id', $this->user->id)->value('signing_failed_count'))->toBe(0);
});

it('needs a PIN before verifying, and a new PIN drops the current grant', function (): void {
    $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '246810'])
        ->assertStatus(409)->assertJson(['code' => 'signing_pin_not_set']);

    setPin($this->user)->assertOk();
    $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '246810'])->assertOk();
    setPin($this->user, '135790')->assertOk();
    expect(app(SigningGrants::class)->has($this->user->id, session()->getId()))->toBeFalse();
    $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '246810'])->assertStatus(403);
    $this->actingAs($this->user)->postJson('/api/v1/signing/verify', ['pin' => '135790'])->assertOk();
});
