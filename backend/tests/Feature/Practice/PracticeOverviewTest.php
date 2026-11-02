<?php

declare(strict_types=1);

use App\Contracts\OutboxHandler;
use App\Jobs\Practice\RefreshTenantKpis;
use App\Models\Platform\User;
use App\Support\Outbox\KpiOutboxHandler;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Support\LedgerFixture;

/*
 * Practice overview (13 §7, plan 2.19). `tenant_kpi_snapshots` has no RLS, so the security core is: the app role has
 * no privilege on it, the sysops functions tie writes to the caller's own tenant, and the read is scoped by the
 * user's active memberships and then by CompanyAccess.
 */

beforeEach(function (): void {
    $this->withHeaders(['Referer' => 'http://localhost', 'Origin' => 'http://localhost', 'Accept' => 'application/json']);
});

function refreshKpis(string $tenantId): void
{
    app(TenantContext::class)->clear();
    RefreshTenantKpis::dispatchSync($tenantId);
}

/** A posting inside the fixture's own tenant; the outbox relay flags the tenant. */
function sell(LedgerFixture $f): void
{
    app(TenantContext::class)->run($f->tenantId, fn () => cashSale($f));
}

function snapshots(): array
{
    return DB::connection('pgsql_owner')->table('tenant_kpi_snapshots')->orderBy('company_id')->get()->all();
}

function joinTenant(LedgerFixture $f, string $userId, string $role = 'member', string $status = 'active'): void
{
    DB::table('tenant_users')->insert(['tenant_id' => $f->tenantId, 'user_id' => $userId, 'role' => $role, 'status' => $status]);
}

/** @return array{0: User, 1: array<string, LedgerFixture>} Nadia, a member of several client tenants in different states */
function firm(): array
{
    $mine = LedgerFixture::create(slug: 'client-a');
    $nadia = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $nadia, 'name' => 'Nadia', 'email' => 'nadia@firm.test', 'password' => 'x']);
    $tenants = ['a' => $mine];
    joinTenant($mine, $nadia, 'admin');
    foreach (['b' => 'active', 'disabled' => 'active', 'cancelled' => 'active', 'deleted' => 'active', 'stranger' => 'active'] as $slug => $_) {
        $tenants[$slug] = LedgerFixture::create(slug: "client-{$slug}");
    }
    joinTenant($tenants['b'], $nadia, 'member');                          // member, no company role
    joinTenant($tenants['disabled'], $nadia, 'owner', 'disabled');
    joinTenant($tenants['cancelled'], $nadia, 'owner');
    joinTenant($tenants['deleted'], $nadia, 'owner');
    DB::connection('pgsql_owner')->table('tenants')->where('id', $tenants['cancelled']->tenantId)->update(['lifecycle' => 'cancelled']);
    DB::connection('pgsql_owner')->table('tenants')->where('id', $tenants['deleted']->tenantId)->update(['lifecycle' => 'deleted']);
    foreach ($tenants as $f) {
        sell($f); // flags the tenant through the outbox handler
    }
    app(TenantContext::class)->clear();

    return [User::query()->findOrFail($nadia), $tenants];
}

it('wires the KPI handler to posting, settlement, approval and period events alongside the webhook handler', function (): void {
    $map = config('outbox.handlers');
    foreach (KpiOutboxHandler::TYPES as $type) {
        expect($map[$type])->toContain(KpiOutboxHandler::class);
    }
    expect($map['journal.posted'])->toHaveCount(2)->and(app(KpiOutboxHandler::class))->toBeInstanceOf(OutboxHandler::class);
});

it('flags the tenant on a posting and creates empty rows for its companies, without computing anything', function (): void {
    $f = LedgerFixture::create();
    sell($f);

    $rows = snapshots();
    expect($rows)->toHaveCount(1)->and($rows[0]->company_id)->toBe($f->companyId)->and($rows[0]->dirty_at)->not->toBeNull()
        ->and($rows[0]->refreshed_at)->toBeNull();
});

it('coalesces a burst of postings into one refresh job and clears the flag only for what it computed', function (): void {
    $f = LedgerFixture::create();
    foreach (range(1, 5) as $_) {
        sell($f);
    }
    app(TenantContext::class)->clear();

    Queue::fake();
    $this->artisan('kpi:refresh', ['--debounce' => 0])->assertSuccessful();
    Queue::assertPushed(RefreshTenantKpis::class, 1);
    Queue::assertPushed(RefreshTenantKpis::class, fn (RefreshTenantKpis $j) => $j->tenantId() === $f->tenantId);
    expect((new RefreshTenantKpis($f->tenantId))->queue)->toBe('maintenance');

    // A flag younger than the debounce is left for a later sweep.
    Queue::fake();
    $this->artisan('kpi:refresh', ['--debounce' => 3600])->assertSuccessful();
    Queue::assertNothingPushed();

    // The faked queue would swallow dispatchSync, so run the job body in its tenant, as the middleware would.
    app(TenantContext::class)->run($f->tenantId, fn () => app()->call([new RefreshTenantKpis($f->tenantId), 'handle']));
    $row = snapshots()[0];
    expect($row->dirty_at)->toBeNull()->and($row->refreshed_at)->not->toBeNull();
    Queue::fake();
    $this->artisan('kpi:refresh', ['--debounce' => 0])->assertSuccessful();
    Queue::assertNothingPushed();

    // A flag raised after the computation started survives it.
    app(TenantContext::class)->run($f->tenantId, fn () => DB::select('SELECT sysops.mark_kpi_dirty(?)', [$f->tenantId]));
    app(TenantContext::class)->run($f->tenantId, fn () => DB::select("SELECT sysops.store_kpi_snapshots(?, now() - interval '1 hour', ?::jsonb)", [
        $f->tenantId, json_encode([['company_id' => $f->companyId, 'company_name' => 'Acme', 'base_currency' => 'USD', 'open_ar' => 5, 'open_ap' => 0, 'pending_approvals' => 0, 'last_closed_period' => null, 'period_states' => []]]),
    ]));
    $row = snapshots()[0];
    expect($row->dirty_at)->not->toBeNull()->and((int) $row->open_ar)->toBe(5);
});

it('runs as a tenant-aware job and refuses to start inside a leaked context', function (): void {
    $f = LedgerFixture::create();
    sell($f);
    $job = new RefreshTenantKpis($f->tenantId);
    expect($job)->toBeInstanceOf(TenantAware::class)->and($job->tenantId())->toBe($f->tenantId)->and($job->companyId())->toBeNull();

    app(TenantContext::class)->set($f->tenantId);
    expect(fn () => RefreshTenantKpis::dispatchSync($f->tenantId))->toThrow(LogicException::class, 'still set');

    refreshKpis($f->tenantId);
    expect(app(TenantContext::class)->id())->toBeNull()->and(snapshots()[0]->refreshed_at)->not->toBeNull();
});

it('drops the rows of a company that is no longer active on the next refresh', function (): void {
    $f = LedgerFixture::create();
    sell($f);
    refreshKpis($f->tenantId);
    app(TenantContext::class)->run($f->tenantId, fn () => DB::table('companies')->where('id', $f->companyId)->update(['status' => 'archived']));
    refreshKpis($f->tenantId);

    expect(snapshots())->toBe([]);
});

it('lists only live tenants where the user has an active membership, and nothing of anyone else\'s', function (): void {
    [$nadia, $t] = firm();
    foreach ($t as $f) {
        refreshKpis($f->tenantId);
    }

    $res = $this->actingAs($nadia)->getJson('/api/v1/practice/overview')->assertOk();
    $practices = $res->json('data.practices');

    expect(array_column(array_column($practices, 'tenant'), 'id'))->toEqualCanonicalizing([$t['a']->tenantId, $t['b']->tenantId]);
    $a = collect($practices)->firstWhere('tenant.id', $t['a']->tenantId);
    $b = collect($practices)->firstWhere('tenant.id', $t['b']->tenantId);
    expect(array_column($a['companies'], 'id'))->toBe([$t['a']->companyId])
        ->and($a['role'])->toBe('admin')
        // a plain member with no company role is a member of the client, but opens no company
        ->and($b['companies'])->toBe([]);

    // Disabled, cancelled, deleted and unrelated tenants leave no trace in the payload.
    foreach (['disabled', 'cancelled', 'deleted', 'stranger'] as $k) {
        expect($res->getContent())->not->toContain($t[$k]->tenantId)->not->toContain($t[$k]->companyId)->not->toContain("client-{$k}");
    }
});

it('gives the SPA the switch request and marks the current organisation', function (): void {
    [$nadia, $t] = firm();
    refreshKpis($t['a']->tenantId);

    $practice = $this->actingAs($nadia)->getJson('/api/v1/practice/overview')->assertOk()->json('data.practices.0');
    expect($practice['switch'])->toBe(['method' => 'PUT', 'path' => '/api/v1/session/tenant', 'body' => ['tenant_id' => $practice['tenant']['id']]])
        ->and($practice['current'])->toBeFalse();

    $this->actingAs($nadia)->putJson($practice['switch']['path'], $practice['switch']['body'])->assertOk()
        ->assertJsonPath('data.tenants.0.current', true);
    $after = $this->getJson('/api/v1/practice/overview')->assertOk()->json('data.practices');
    expect(collect($after)->firstWhere('tenant.id', $practice['tenant']['id'])['current'])->toBeTrue();
});

it('stops showing a client the moment the membership is disabled or removed', function (): void {
    [$nadia, $t] = firm();
    refreshKpis($t['a']->tenantId);
    $ids = fn (): array => array_column($this->actingAs($nadia)->getJson('/api/v1/practice/overview')->assertOk()->json('data.practices.*.tenant'), 'id');
    expect($ids())->toContain($t['a']->tenantId);

    DB::connection('pgsql_owner')->table('tenant_users')->where('tenant_id', $t['a']->tenantId)->where('user_id', $nadia->id)->update(['status' => 'disabled']);
    expect($ids())->not->toContain($t['a']->tenantId);

    DB::connection('pgsql_owner')->table('tenant_users')->where('tenant_id', $t['a']->tenantId)->where('user_id', $nadia->id)->update(['status' => 'active']);
    expect($ids())->toContain($t['a']->tenantId);

    DB::connection('pgsql_owner')->table('tenant_users')->where('tenant_id', $t['a']->tenantId)->where('user_id', $nadia->id)->delete();
    expect($ids())->not->toContain($t['a']->tenantId);
});

it('answers 401 without a session', function (): void {
    $this->getJson('/api/v1/practice/overview')->assertUnauthorized();
});

it('gives the app role no way to read or write the snapshot table directly, in any tenant context', function (): void {
    $a = LedgerFixture::create(slug: 'alpha');
    $b = LedgerFixture::create(slug: 'beta');
    sell($a);
    sell($b);
    refreshKpis($a->tenantId);
    refreshKpis($b->tenantId);
    expect(snapshots())->toHaveCount(2);

    foreach ([null, $a->tenantId, $b->tenantId] as $context) {
        $try = function (string $sql) use ($context): void {
            DB::select('SELECT 1'); // keep the connection alive between failures
            $run = fn () => DB::statement($sql);
            $context === null ? app(TenantContext::class)->clear() : app(TenantContext::class)->set($context);
            expect($run)->toThrow(QueryException::class, 'permission denied');
        };
        $try('SELECT * FROM tenant_kpi_snapshots');
        $try('SELECT count(*) FROM tenant_kpi_snapshots');
        $try('UPDATE tenant_kpi_snapshots SET open_ar = 1');
        $try('DELETE FROM tenant_kpi_snapshots');
    }
    app(TenantContext::class)->clear();

    foreach (['ledgerly_app', 'ledgerly_report', 'ledgerly_platform'] as $role) {
        foreach (['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as $priv) {
            expect(DB::selectOne('SELECT has_table_privilege(?, ?, ?) AS ok', [$role, 'tenant_kpi_snapshots', $priv])->ok)->toBeFalse("{$role} {$priv}");
        }
    }
});

it('lets a tenant context flag and store only its own tenant\'s rows', function (): void {
    $a = LedgerFixture::create(slug: 'alpha');
    $b = LedgerFixture::create(slug: 'beta');
    sell($b);
    refreshKpis($b->tenantId);
    $before = snapshots();

    app(TenantContext::class)->set($a->tenantId);
    expect(fn () => DB::select('SELECT sysops.mark_kpi_dirty(?)', [$b->tenantId]))->toThrow(QueryException::class, 'tenant mismatch');
    expect(fn () => DB::select("SELECT sysops.store_kpi_snapshots(?, now(), '[]'::jsonb)", [$b->tenantId]))->toThrow(QueryException::class, 'tenant mismatch');
    app(TenantContext::class)->clear();
    expect(fn () => DB::select('SELECT sysops.mark_kpi_dirty(?)', [$b->tenantId]))->toThrow(QueryException::class, 'tenant mismatch');

    expect(snapshots())->toEqual($before);
});

it('scopes the read function by the caller: another user\'s id returns only that user\'s tenants', function (): void {
    [$nadia, $t] = firm();
    $other = (string) Str::uuid7();
    DB::table('users')->insert(['id' => $other, 'name' => 'Omar', 'email' => 'omar@other.test', 'password' => 'x']);
    joinTenant($t['stranger'], $other, 'owner');
    refreshKpis($t['stranger']->tenantId);

    $tenantsOf = fn (string $id): array => array_values(array_unique(array_map(fn ($r) => $r->tenant_id, DB::select('SELECT tenant_id FROM sysops.practice_overview(?)', [$id]))));
    expect($tenantsOf($other))->toBe([$t['stranger']->tenantId])
        ->and($tenantsOf((string) Str::uuid7()))->toBe([])
        ->and($tenantsOf($nadia->id))->not->toContain($t['stranger']->tenantId);
});
