<?php

declare(strict_types=1);

use App\Models\Platform\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Password;
use Tests\Support\LedgerFixture;

/*
 * Forgotten passwords (02_AppFlow §2): the request never reveals whether an address has an
 * account, and a link that is no good has its own code.
 */

beforeEach(function (): void {
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
    LedgerFixture::create(slug: 'acme');
    app(TenantContext::class)->clear();
    $this->user = User::query()->where('email', 'maker@acme.test')->firstOrFail();
    DB::table('users')->where('id', $this->user->id)->update(['password' => Hash::make('Correct-Horse-42')]);
});

it('answers the same for known, unknown and throttled addresses, and mails only the known one', function (): void {
    Notification::fake();

    $known = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'maker@acme.test'])->assertOk();
    $unknown = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'nobody@acme.test'])->assertOk();
    // The broker refuses a second link inside its throttle window; that must not read differently.
    $throttled = $this->postJson('/api/v1/auth/forgot-password', ['email' => 'maker@acme.test'])->assertOk();

    expect($unknown->json())->toBe($known->json())->and($throttled->json())->toBe($known->json());
    Notification::assertSentToTimes($this->user, ResetPassword::class, 1);
});

it('still validates the address itself', function (): void {
    $this->postJson('/api/v1/auth/forgot-password', ['email' => ''])
        ->assertStatus(422)->assertJson(['code' => 'validation_failed'])->assertJsonValidationErrors(['email']);
});

it('resets with a good link, then refuses that link with its own code', function (): void {
    $token = Password::broker()->createToken($this->user);
    $body = ['token' => $token, 'email' => 'maker@acme.test', 'password' => 'Another-Horse-77', 'password_confirmation' => 'Another-Horse-77'];

    $this->postJson('/api/v1/auth/reset-password', $body)->assertOk();
    expect(Hash::check('Another-Horse-77', (string) $this->user->fresh()?->password))->toBeTrue();

    $this->postJson('/api/v1/auth/reset-password', $body)->assertStatus(422)->assertJson(['code' => 'reset_link_invalid']);
});

it('gives one code for a wrong token and an unknown address, and leaves the password alone', function (): void {
    $body = ['password' => 'Another-Horse-77', 'password_confirmation' => 'Another-Horse-77'];

    $wrong = $this->postJson('/api/v1/auth/reset-password', [...$body, 'token' => 'nope', 'email' => 'maker@acme.test'])
        ->assertStatus(422)->assertJson(['code' => 'reset_link_invalid']);
    $stranger = $this->postJson('/api/v1/auth/reset-password', [...$body, 'token' => 'nope', 'email' => 'nobody@acme.test'])
        ->assertStatus(422)->assertJson(['code' => 'reset_link_invalid']);

    expect($stranger->json('detail'))->toBe($wrong->json('detail'))
        ->and(Hash::check('Correct-Horse-42', (string) $this->user->fresh()?->password))->toBeTrue();
});

it('asks for the password with a problem code before a confirmed-password action', function (): void {
    $this->actingAs($this->user, 'web')->postJson('/api/v1/auth/user/two-factor-authentication')
        ->assertStatus(423)->assertJson(['code' => 'password_confirmation_required']);

    $this->postJson('/api/v1/auth/user/confirm-password', ['password' => 'Correct-Horse-42'])->assertCreated();
    $this->postJson('/api/v1/auth/user/two-factor-authentication')->assertOk();
});
