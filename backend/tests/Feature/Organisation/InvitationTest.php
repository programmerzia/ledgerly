<?php

declare(strict_types=1);

use App\Actions\Organisation\SeedCompanyRoles;
use App\Models\Platform\User;
use App\Notifications\InvitationNotification;
use App\Support\Tenancy\TenantContext;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\Support\LedgerFixture;

/*
 * Invitations (02_AppFlow §2, §3 step 5): owners and admins invite, the link previews and accepts,
 * a new invitee creates their account, an existing one signs in first; tokens are stored hashed.
 */

beforeEach(function (): void {
    Notification::fake();
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
});

/** A tenant whose company has its roles seeded; the context is cleared like at request start. */
function invitingTenant(string $slug = 'acme'): LedgerFixture
{
    $f = LedgerFixture::create(slug: $slug);
    app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId);
    app(TenantContext::class)->clear();

    return $f;
}

function owner(LedgerFixture $f): User
{
    return User::query()->findOrFail($f->userId);
}

/**
 * Every real request gets fresh guards; in a test they persist (and `auth:sanctum` switches the
 * default to the sanctum guard), so reset them before acting as someone else or as a guest.
 */
function freshGuards(): void
{
    app('auth')->forgetGuards();
    app('auth')->setDefaultDriver('web');
}

/** Invites $email as the fixture's owner and returns the raw token from the email. */
function invite(LedgerFixture $f, string $email, array $body = []): string
{
    test()->actingAs(owner($f))->postJson('/api/v1/invitations', [
        'email' => $email, 'role' => 'member', 'company_role' => 'Accountant', 'company_ids' => [$f->companyId], ...$body,
    ])->assertCreated();
    auth()->guard('web')->logout();
    freshGuards();

    $token = null;
    Notification::assertSentTo(new AnonymousNotifiable, InvitationNotification::class, function (InvitationNotification $n, array $channels, AnonymousNotifiable $to) use ($email, &$token): bool {
        if ($to->routes['mail'] === mb_strtolower($email)) {
            $token = $n->token;
        }

        return true;
    });

    return (string) $token;
}

it('stores only the token hash and emails the link', function (): void {
    $f = invitingTenant();
    $token = invite($f, 'New.Person@example.test');

    app(TenantContext::class)->run($f->tenantId, function () use ($token): void {
        $row = DB::table('invitations')->first();
        expect($row->email)->toBe('new.person@example.test')
            ->and($row->token_hash)->toBe(hash('sha256', $token))
            ->and($row->expires_at)->toStartWith('2026-03-22');
    });
    $mail = (new InvitationNotification($token, 'Acme', 'Maker acme'))->toMail(new AnonymousNotifiable);
    expect($mail->actionUrl)->toBe('http://localhost:5173/invitations/'.$token);
});

it('previews the invitation and lets a new person create their account and join', function (): void {
    $f = invitingTenant();
    $token = invite($f, 'new@example.test');

    $this->getJson("/api/v1/invitation-tokens/{$token}")->assertOk()->assertJson(['data' => [
        'organisation' => 'Acme', 'email' => 'new@example.test', 'role' => 'member', 'company_role' => 'Accountant',
        'status' => 'open', 'account_exists' => false,
    ]]);

    $this->postJson("/api/v1/invitation-tokens/{$token}/accept", ['name' => 'New Person'])
        ->assertStatus(422)->assertJsonValidationErrors(['password']);
    $this->postJson("/api/v1/invitation-tokens/{$token}/accept", [
        'name' => 'New Person', 'password' => 'Correct-Horse-42', 'password_confirmation' => 'Correct-Horse-42',
    ])->assertOk()->assertJsonPath('data.tenant_id', $f->tenantId);

    // Signed in, inside the organisation, and able to open the company with the invited role.
    $this->getJson('/api/v1/me')->assertOk()->assertJsonPath('data.email', 'new@example.test')
        ->assertJsonPath('data.tenants.0.role', 'member');
    $this->getJson('/api/v1/companies')->assertOk()->assertJsonPath('data.0.id', $f->companyId);

    $user = User::query()->where('email', 'new@example.test')->firstOrFail();
    setPermissionsTeamId($f->companyId);
    app(TenantContext::class)->run($f->tenantId, fn () => expect($user->hasRole('Accountant'))->toBeTrue());
    setPermissionsTeamId(null);

    $this->getJson("/api/v1/invitation-tokens/{$token}")->assertOk()->assertJsonPath('data.status', 'accepted');
    $this->postJson('/api/v1/auth/logout');
    $this->postJson("/api/v1/invitation-tokens/{$token}/accept", [
        'name' => 'Again', 'password' => 'Correct-Horse-42', 'password_confirmation' => 'Correct-Horse-42',
    ])->assertStatus(409)->assertJson(['code' => 'invitation_already_accepted']);
});

it('makes someone with an account sign in first, then accept as that account only', function (): void {
    $a = invitingTenant('alpha');
    $b = invitingTenant('beta');
    DB::table('users')->where('id', $b->userId)->update(['password' => Hash::make('Correct-Horse-42')]);
    $token = invite($a, 'maker@beta.test');

    $this->getJson("/api/v1/invitation-tokens/{$token}")->assertJsonPath('data.account_exists', true);
    $this->postJson("/api/v1/invitation-tokens/{$token}/accept", [
        'name' => 'Takeover', 'password' => 'Correct-Horse-42', 'password_confirmation' => 'Correct-Horse-42',
    ])->assertStatus(409)->assertJson(['code' => 'sign_in_required']);

    // A different signed-in account cannot use the link.
    // The link route has no auth middleware; it reads the SPA session (web guard).
    $this->actingAs(owner($a), 'web')->postJson("/api/v1/invitation-tokens/{$token}/accept")
        ->assertStatus(403)->assertJson(['code' => 'invitation_email_mismatch']);
    auth()->guard('web')->logout();
    freshGuards();

    $this->postJson('/api/v1/auth/login', ['email' => 'maker@beta.test', 'password' => 'Correct-Horse-42'])->assertSuccessful();
    $this->postJson("/api/v1/invitation-tokens/{$token}/accept")->assertOk();
    expect(session('current_tenant_id'))->toBe($a->tenantId);
    $this->getJson('/api/v1/me')->assertJsonCount(2, 'data.tenants');
});

it('rejects unknown, expired and withdrawn links', function (): void {
    $f = invitingTenant();
    $this->getJson('/api/v1/invitation-tokens/not-a-real-token')->assertStatus(404)->assertJson(['code' => 'invitation_not_found']);

    $expired = invite($f, 'late@example.test');
    $this->clock->advance('+8 days');
    $this->getJson("/api/v1/invitation-tokens/{$expired}")->assertJsonPath('data.status', 'expired');
    $this->postJson("/api/v1/invitation-tokens/{$expired}/accept", [
        'name' => 'Late', 'password' => 'Correct-Horse-42', 'password_confirmation' => 'Correct-Horse-42',
    ])->assertStatus(410)->assertJson(['code' => 'invitation_expired']);

    $withdrawn = invite($f, 'gone@example.test');
    $id = app(TenantContext::class)->run($f->tenantId, fn () => DB::table('invitations')->where('email', 'gone@example.test')->value('id'));
    $this->actingAs(owner($f))->deleteJson("/api/v1/invitations/{$id}")->assertNoContent();
    auth()->guard('web')->logout();
    freshGuards();
    $this->postJson("/api/v1/invitation-tokens/{$withdrawn}/accept", [
        'name' => 'Gone', 'password' => 'Correct-Horse-42', 'password_confirmation' => 'Correct-Horse-42',
    ])->assertStatus(410)->assertJson(['code' => 'invitation_revoked']);

    expect(User::query()->whereIn('email', ['late@example.test', 'gone@example.test'])->exists())->toBeFalse();
});

it('replaces an open invitation when the same email is invited again', function (): void {
    $f = invitingTenant();
    $first = invite($f, 'twice@example.test');
    Notification::fake();
    $second = invite($f, 'twice@example.test');

    $this->getJson("/api/v1/invitation-tokens/{$first}")->assertJsonPath('data.status', 'revoked');
    $this->getJson("/api/v1/invitation-tokens/{$second}")->assertJsonPath('data.status', 'open');
    $this->actingAs(owner($f))->getJson('/api/v1/invitations')->assertOk()->assertJsonCount(1, 'data');
});

it('lets owners and admins invite, admins only members, and requires a company role for members', function (): void {
    $f = invitingTenant();
    $adminId = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $adminId, 'name' => 'Admin', 'email' => 'admin@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $adminId, 'role' => 'admin']);
    $admin = User::query()->findOrFail($adminId);
    $member = ['email' => 'm@example.test', 'role' => 'member', 'company_role' => 'Viewer', 'company_ids' => [$f->companyId]];

    $this->actingAs($admin)->postJson('/api/v1/invitations', ['email' => 'a@example.test', 'role' => 'admin'])
        ->assertStatus(403)->assertJson(['code' => 'forbidden']);
    $this->actingAs($admin)->postJson('/api/v1/invitations', $member)->assertCreated();
    $this->actingAs(owner($f))->postJson('/api/v1/invitations', ['email' => 'a@example.test', 'role' => 'admin'])->assertCreated();

    $this->actingAs(owner($f))->postJson('/api/v1/invitations', ['email' => 'x@example.test', 'role' => 'member'])
        ->assertStatus(422)->assertJson(['code' => 'company_role_required']);
    $this->actingAs(owner($f))->postJson('/api/v1/invitations', [...$member, 'email' => 'y@example.test', 'company_role' => 'Wizard'])
        ->assertStatus(422)->assertJson(['code' => 'role_not_found']);
    $this->actingAs(owner($f))->postJson('/api/v1/invitations', ['email' => 'admin@acme.test', 'role' => 'admin'])
        ->assertStatus(409)->assertJson(['code' => 'already_member']);

    // Another tenant's company is invisible (RLS), so it cannot be granted.
    $other = invitingTenant('beta');
    $this->actingAs(owner($f))->postJson('/api/v1/invitations', [...$member, 'email' => 'z@example.test', 'company_ids' => [$other->companyId]])
        ->assertStatus(404)->assertJson(['code' => 'company_not_found']);

    // Plain members can neither invite nor list invitations.
    DB::table('tenant_users')->where('user_id', $adminId)->update(['role' => 'member']);
    $this->actingAs($admin)->postJson('/api/v1/invitations', [...$member, 'email' => 'w@example.test'])->assertStatus(403);
    $this->actingAs($admin)->getJson('/api/v1/invitations')->assertStatus(403);
});
