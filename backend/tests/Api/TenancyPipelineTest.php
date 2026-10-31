<?php

declare(strict_types=1);

use App\Actions\Organisation\AssignCompanyRole;
use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Actions\Organisation\SeedCompanyRoles;
use App\Models\Organisation\ApiClient;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\CompanyContext;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\WithTenantContext;
use Illuminate\Session\Middleware\StartSession;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Support\LedgerFixture;

/*
 * 13 §5–§7 request pipeline: request ids, tenant resolution and context, lifecycle and 2FA gates,
 * company access, API client tokens, and tenant-aware jobs.
 */

beforeEach(function (): void {
    $probe = fn () => response()->json([
        'tenant' => DB::selectOne("SELECT current_setting('app.tenant_id', true) AS t")->t,
        'company' => app(CompanyContext::class)->id(),
        'companies' => DB::table('companies')->count(),
    ]);

    // StartSession stands in for Sanctum's stateful SPA stack (wired in plan step 1.4).
    Route::middleware(['api', StartSession::class, 'auth:sanctum', 'tenant', 'tenant.writable'])->group(function () use ($probe): void {
        Route::match(['GET', 'POST'], 'api/v1/_probe', $probe);
        Route::get('api/v1/_probe/companies/{company}', $probe)->middleware('company');
    });
});

/** A tenant with an owner, a company and a chart; the context is cleared like at request start. */
function tenantFixture(string $slug = 'acme'): LedgerFixture
{
    $f = LedgerFixture::create(slug: $slug);
    app(TenantContext::class)->clear();

    return $f;
}

function userOf(LedgerFixture $f): User
{
    return User::query()->findOrFail($f->userId);
}

/** @param list<string> $companyIds */
function apiClientFor(LedgerFixture $f, array $companyIds, bool $revoked = false): string
{
    return app(TenantContext::class)->run($f->tenantId, function () use ($f, $companyIds, $revoked): string {
        $client = new ApiClient;
        $client->forceFill([
            'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'name' => 'ERP sync',
            'company_ids' => $companyIds, 'created_by' => $f->userId, 'revoked_at' => $revoked ? now() : null,
        ])->save();

        return $client->createToken('sync', ['journals:read'])->plainTextToken;
    });
}

it('assigns a request id, echoes a valid one, and replaces a malformed one', function (): void {
    $f = tenantFixture();
    $this->actingAs(userOf($f));

    $minted = $this->getJson('/api/v1/_probe')->assertOk()->headers->get('X-Request-Id');
    expect($minted)->toMatch('/^[0-9a-f-]{36}$/');

    $this->getJson('/api/v1/_probe', ['X-Request-Id' => 'client-abc-123'])->assertHeader('X-Request-Id', 'client-abc-123');
    expect($this->getJson('/api/v1/_probe', ['X-Request-Id' => "bad id\n"])->headers->get('X-Request-Id'))->not->toBe("bad id\n");
});

it('selects a single membership automatically, sets the context for the request and clears it after', function (): void {
    $f = tenantFixture();
    $this->actingAs(userOf($f));

    $this->getJson('/api/v1/_probe')->assertOk()->assertJson(['tenant' => $f->tenantId, 'companies' => 1]);
    expect(app(TenantContext::class)->id())->toBeNull()
        ->and(DB::selectOne("SELECT current_setting('app.tenant_id', true) AS t")->t)->toBe('');
});

it('makes a user with several memberships choose, and rejects a tenant they do not belong to', function (): void {
    $a = tenantFixture('alpha');
    $b = tenantFixture('beta');
    $outsider = tenantFixture('gamma');
    DB::table('tenant_users')->insert(['tenant_id' => $b->tenantId, 'user_id' => $a->userId, 'role' => 'admin']);
    $this->actingAs(userOf($a));

    $this->getJson('/api/v1/_probe')->assertStatus(409)->assertJson(['code' => 'tenant_required']);
    $this->withSession(['current_tenant_id' => $b->tenantId])->getJson('/api/v1/_probe')
        ->assertOk()->assertJson(['tenant' => $b->tenantId]);
    $this->withSession(['current_tenant_id' => $outsider->tenantId])->getJson('/api/v1/_probe')
        ->assertStatus(403)->assertJson(['code' => 'tenant_access_denied']);

    DB::table('tenant_users')->where('tenant_id', $b->tenantId)->where('user_id', $a->userId)->update(['status' => 'disabled']);
    $this->withSession(['current_tenant_id' => $b->tenantId])->getJson('/api/v1/_probe')->assertStatus(403);
});

it('refuses closed tenants and lets read-only tenants read but not write', function (): void {
    $f = tenantFixture();
    $this->actingAs(userOf($f));

    DB::table('tenants')->where('id', $f->tenantId)->update(['lifecycle' => 'read_only']);
    $this->getJson('/api/v1/_probe')->assertOk();
    $this->postJson('/api/v1/_probe')->assertStatus(423)->assertJson(['code' => 'tenant_read_only']);

    DB::table('tenants')->where('id', $f->tenantId)->update(['lifecycle' => 'cancelled']);
    $this->getJson('/api/v1/_probe')->assertStatus(403)->assertJson(['code' => 'tenant_unavailable']);
});

it('enforces tenant-required two-factor authentication', function (): void {
    $f = tenantFixture();
    DB::table('tenants')->where('id', $f->tenantId)->update(['settings' => json_encode(['require_two_factor' => true])]);
    $this->actingAs(userOf($f));

    $this->getJson('/api/v1/_probe')->assertStatus(403)->assertJson(['code' => 'two_factor_required']);

    DB::table('users')->where('id', $f->userId)->update(['two_factor_confirmed_at' => now()]);
    $this->actingAs(userOf($f));
    $this->getJson('/api/v1/_probe')->assertOk();
});

it('opens a company of the tenant for owners, hides other tenants\' companies, and denies plain members', function (): void {
    $a = tenantFixture('alpha');
    $b = tenantFixture('beta');
    $this->actingAs(userOf($a));

    $this->getJson("/api/v1/_probe/companies/{$a->companyId}")->assertOk()->assertJson(['company' => $a->companyId]);
    expect(app(CompanyContext::class)->id())->toBeNull();
    $this->getJson("/api/v1/_probe/companies/{$b->companyId}")->assertStatus(404)->assertJson(['code' => 'company_not_found']);
    $this->getJson('/api/v1/_probe/companies/not-a-uuid')->assertStatus(404);

    DB::table('tenant_users')->where('tenant_id', $a->tenantId)->update(['role' => 'member']);
    $this->getJson("/api/v1/_probe/companies/{$a->companyId}")->assertStatus(403)->assertJson(['code' => 'company_access_denied']);
});

it('authenticates API client tokens inside their tenant and limits them to their companies', function (): void {
    $a = tenantFixture('alpha');
    $token = apiClientFor($a, [$a->companyId]);

    $this->withToken($token)->getJson('/api/v1/_probe')->assertOk()->assertJson(['tenant' => $a->tenantId]);
    $this->withToken($token)->getJson("/api/v1/_probe/companies/{$a->companyId}")->assertOk();
    expect(app(TenantContext::class)->id())->toBeNull();

    $other = app(TenantContext::class)->run($a->tenantId, function () use ($a): string {
        $id = (string) Str::uuid7();
        DB::table('companies')->insert(['id' => $id, 'tenant_id' => $a->tenantId, 'name' => 'Second', 'slug' => 'second', 'country' => 'US', 'base_currency' => 'USD']);

        return $id;
    });
    $this->withToken($token)->getJson("/api/v1/_probe/companies/{$other}")->assertStatus(403);
});

it('rejects revoked clients, wrong secrets and tokens re-pointed at another tenant', function (): void {
    $a = tenantFixture('alpha');
    $b = tenantFixture('beta');

    $this->withToken(apiClientFor($a, [$a->companyId], revoked: true))->getJson('/api/v1/_probe')->assertStatus(401);

    $token = apiClientFor($a, [$a->companyId]);
    [$id] = explode('|', $token, 2);
    $this->withToken($id.'|wrong-secret')->getJson('/api/v1/_probe')->assertStatus(401);

    // Pointing the token row at tenant B hides the client (RLS), so authentication fails.
    DB::table('personal_access_tokens')->where('id', (int) $id)->update(['tenant_id' => $b->tenantId]);
    $this->withToken($token)->getJson('/api/v1/_probe')->assertStatus(401);
    expect(app(TenantContext::class)->id())->toBeNull();
});

it('runs tenant-aware jobs in their own tenant and refuses to start on a leaked context', function (): void {
    $a = tenantFixture('alpha');
    $b = tenantFixture('beta');
    $middleware = app(WithTenantContext::class);
    $job = fn (string $tenant, ?string $company) => new class($tenant, $company) implements TenantAware
    {
        public function __construct(private string $t, private ?string $c) {}

        public function tenantId(): string
        {
            return $this->t;
        }

        public function companyId(): ?string
        {
            return $this->c;
        }
    };

    $seen = [];
    foreach ([[$a, $a->companyId], [$b, null], [$a, null]] as [$f, $company]) {
        $seen[] = $middleware->handle($job($f->tenantId, $company), fn () => [
            DB::table('companies')->value('id'), app(CompanyContext::class)->id(), getPermissionsTeamId(),
        ]);
    }
    expect($seen)->toBe([[$a->companyId, $a->companyId, $a->companyId], [$b->companyId, null, null], [$a->companyId, null, null]])
        ->and(app(TenantContext::class)->id())->toBeNull();

    app(TenantContext::class)->set($a->tenantId);
    expect(fn () => $middleware->handle($job($b->tenantId, null), fn () => null))->toThrow(LogicException::class);
});

it('opens a company for a plain member who holds a role in it, and only that company', function (): void {
    $f = tenantFixture('alpha');
    app(TenantContext::class)->set($f->tenantId);
    $second = (string) Str::uuid7();
    DB::table('companies')->insert(['id' => $second, 'tenant_id' => $f->tenantId, 'name' => 'Second', 'slug' => 'second', 'country' => 'US', 'base_currency' => 'USD']);
    app(SeedCompanyRoles::class)->handle($f->actor, $f->companyId);
    DB::table('tenant_users')->where('tenant_id', $f->tenantId)->update(['role' => 'member']);
    app(TenantContext::class)->clear();

    $actor = new Actor(ActorType::User, $f->userId, $f->tenantId, $f->companyId);
    $adminId = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $adminId, 'name' => 'Admin', 'email' => 'admin@alpha.test', 'password' => 'x']);
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $adminId, 'role' => 'admin']);
    app(TenantContext::class)->set($f->tenantId);
    app(AssignCompanyRole::class)->handle(
        new Actor(ActorType::User, $adminId, $f->tenantId),
        new CompanyRoleInput($actor->id, $f->companyId, 'Accountant'),
    );
    app(TenantContext::class)->clear();

    $this->actingAs(userOf($f));
    $this->getJson("/api/v1/_probe/companies/{$f->companyId}")->assertOk()->assertJson(['company' => $f->companyId]);
    $this->getJson("/api/v1/_probe/companies/{$second}")->assertStatus(403)->assertJson(['code' => 'company_access_denied']);
});
