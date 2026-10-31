<?php

declare(strict_types=1);

use App\Actions\Organisation\CreateCompany;
use App\Actions\Organisation\Inputs\CreateCompanyInput;
use App\Models\Organisation\ApiClient;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Idempotency\ClaimOutcome;
use App\Support\Idempotency\IdempotencyScope;
use App\Support\Idempotency\IdempotencyStore;
use App\Support\Idempotency\RequestFingerprint;
use App\Support\Tenancy\TenantContext;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/*
 * Idempotency-Key (13 §11): a retried request never applies twice, a reused key with another body
 * is refused, a live attempt blocks its twin, a dead one is taken over, and failures free the key.
 */

const NEW_COMPANY = [
    'name' => 'Globex Ltd', 'country' => 'GB', 'base_currency' => 'GBP', 'fiscal_year_start_month' => 4,
];

beforeEach(function (): void {
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
    $this->f = LedgerFixture::create();
    app(TenantContext::class)->clear();
    $this->owner = User::query()->findOrFail($this->f->userId);
});

function companies(LedgerFixture $f): int
{
    return app(TenantContext::class)->run($f->tenantId, fn () => DB::table('companies')->count());
}

function keyRow(LedgerFixture $f, string $key): ?object
{
    return app(TenantContext::class)->run($f->tenantId, fn () => DB::table('idempotency_keys')->where('key', $key)->first());
}

it('replays the stored response for a retry and applies the change once', function (): void {
    $first = $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-1'])->assertCreated();
    $retry = $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-1'])->assertCreated();

    $retry->assertHeader('Idempotent-Replayed', 'true');
    expect($retry->json('data.id'))->toBe($first->json('data.id'))
        ->and($first->headers->has('Idempotent-Replayed'))->toBeFalse()
        ->and(companies($this->f))->toBe(2)
        ->and(keyRow($this->f, 'k-1'))->state->toBe('completed')->subject_type->toBe('companies')->subject_id->toBe($first->json('data.id'));
});

it('matches a retry by meaning, so key order in the body does not matter', function (): void {
    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-order'])->assertCreated();
    $this->actingAs($this->owner)->postJson('/api/v1/companies', array_reverse(NEW_COMPANY, true), ['Idempotency-Key' => 'k-order'])
        ->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
});

it('refuses a key reused for a different request', function (): void {
    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-2'])->assertCreated();
    $this->actingAs($this->owner)->postJson('/api/v1/companies', [...NEW_COMPANY, 'name' => 'Other'], ['Idempotency-Key' => 'k-2'])
        ->assertStatus(422)->assertJson(['code' => 'idempotency_key_reuse']);

    expect(companies($this->f))->toBe(2);
});

it('answers 409 with Retry-After while another attempt holds the lease, and takes over a dead one', function (): void {
    $scope = new IdempotencyScope($this->f->tenantId, 'user', $this->owner->id, 'k-3');
    $request = Request::create('/api/v1/companies', 'POST', server: ['CONTENT_TYPE' => 'application/json'], content: json_encode(NEW_COMPANY));
    $hash = RequestFingerprint::of($request);
    app(TenantContext::class)->run($this->f->tenantId, fn () => app(IdempotencyStore::class)->claim($scope, $hash));

    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-3'])
        ->assertStatus(409)->assertHeader('Retry-After', '1')->assertJson(['code' => 'idempotency_in_progress']);

    // The first attempt died without committing: once its lease ends, a retry runs the request.
    app(TenantContext::class)->run($this->f->tenantId, fn () => DB::table('idempotency_keys')->where('key', 'k-3')->update(['lease_until' => now()->subSecond()]));
    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-3'])->assertCreated();
    expect(companies($this->f))->toBe(2);
});

it('commits the key with the business change, so a lost response replays the current resource', function (): void {
    $actor = new Actor(ActorType::User, $this->owner->id, $this->f->tenantId, idempotencyKey: 'k-4');
    $scope = new IdempotencyScope($this->f->tenantId, 'user', $this->owner->id, 'k-4');
    $request = Request::create('/api/v1/companies', 'POST', server: ['CONTENT_TYPE' => 'application/json'], content: json_encode(NEW_COMPANY));

    $company = app(TenantContext::class)->run($this->f->tenantId, function () use ($scope, $request, $actor) {
        expect(app(IdempotencyStore::class)->claim($scope, RequestFingerprint::of($request))->outcome)->toBe(ClaimOutcome::Execute);

        // The Action commits; the process dies before the response is stored.
        return app(CreateCompany::class)->handle($actor, new CreateCompanyInput(
            name: 'Globex Ltd', country: 'GB', baseCurrency: 'GBP', fiscalYearStartMonth: 4,
        ));
    });
    expect(keyRow($this->f, 'k-4')->state)->toBe('committed');

    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-4'])
        ->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $company->id);
    expect(companies($this->f))->toBe(2);
});

it('leaves the key pending when the business transaction rolls back', function (): void {
    $actor = new Actor(ActorType::User, $this->owner->id, $this->f->tenantId, idempotencyKey: 'k-5');
    $scope = new IdempotencyScope($this->f->tenantId, 'user', $this->owner->id, 'k-5');

    app(TenantContext::class)->run($this->f->tenantId, function () use ($scope, $actor): void {
        app(IdempotencyStore::class)->claim($scope, str_repeat('a', 64));
        expect(fn () => app(UnitOfWork::class)->run($actor, function (LockSet $l, AuditBuffer $a, Outbox $o): never {
            throw new RuntimeException('boom');
        }))->toThrow(RuntimeException::class);
    });

    expect(keyRow($this->f, 'k-5')->state)->toBe('pending');
});

it('stores and replays validation errors, but frees the key after a refusal so a retry can succeed', function (): void {
    $this->actingAs($this->owner)->postJson('/api/v1/companies', ['name' => ''], ['Idempotency-Key' => 'k-6'])->assertStatus(422);
    $this->actingAs($this->owner)->postJson('/api/v1/companies', ['name' => ''], ['Idempotency-Key' => 'k-6'])
        ->assertStatus(422)->assertHeader('Idempotent-Replayed', 'true')->assertHeader('Content-Type', 'application/problem+json');

    // 403 for a plain member: the key is released, so after being promoted the same retry works.
    DB::table('tenant_users')->where('user_id', $this->owner->id)->update(['role' => 'member']);
    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-7'])->assertStatus(403);
    expect(keyRow($this->f, 'k-7'))->toBeNull();
    DB::table('tenant_users')->where('user_id', $this->owner->id)->update(['role' => 'owner']);
    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'k-7'])->assertCreated();
});

it('scopes keys per actor and requires one from API clients', function (): void {
    $otherId = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $otherId, 'name' => 'Admin', 'email' => 'admin@acme.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $this->f->tenantId, 'user_id' => $otherId, 'role' => 'admin']);

    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'shared'])->assertCreated();
    $this->actingAs(User::query()->findOrFail($otherId))->postJson('/api/v1/companies', [...NEW_COMPANY, 'name' => 'Initech'], ['Idempotency-Key' => 'shared'])
        ->assertCreated()->assertHeaderMissing('Idempotent-Replayed');

    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => "bad key\n"])
        ->assertStatus(400)->assertJson(['code' => 'idempotency_key_invalid']);

    $token = app(TenantContext::class)->run($this->f->tenantId, function (): string {
        $client = new ApiClient;
        $client->forceFill(['id' => (string) Str::uuid7(), 'tenant_id' => $this->f->tenantId, 'name' => 'Sync', 'company_ids' => [$this->f->companyId], 'created_by' => $this->f->userId])->save();

        return $client->createToken('sync')->plainTextToken;
    });
    app('auth')->forgetGuards();
    $this->withHeaders(['Referer' => '', 'Origin' => ''])->withToken($token)->postJson('/api/v1/companies', NEW_COMPANY)
        ->assertStatus(428)->assertJson(['code' => 'idempotency_key_required']);
});

it('purges keys older than a day', function (): void {
    $this->actingAs($this->owner)->postJson('/api/v1/companies', NEW_COMPANY, ['Idempotency-Key' => 'old'])->assertCreated();
    $this->actingAs($this->owner)->postJson('/api/v1/companies', [...NEW_COMPANY, 'name' => 'Fresh'], ['Idempotency-Key' => 'new'])->assertCreated();
    app(TenantContext::class)->run($this->f->tenantId, fn () => DB::table('idempotency_keys')->where('key', 'old')->update(['created_at' => now()->subHours(25)]));

    $this->artisan('idempotency:purge')->expectsOutputToContain('Purged 1')->assertSuccessful();
    expect(keyRow($this->f, 'old'))->toBeNull()->and(keyRow($this->f, 'new'))->not->toBeNull();
});
