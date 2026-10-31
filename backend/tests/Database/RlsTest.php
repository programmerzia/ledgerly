<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

it('runs the app as a non-owner role without BYPASSRLS', function () {
    $role = DB::selectOne('SELECT current_user AS u, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user');
    expect($role->u)->toBe('ledgerly_app')->and($role->bypass)->toBeFalse();
});

it('forces RLS with the tenant policy on every table not on the global allowlist', function () {
    $tables = DB::select(<<<'SQL'
        SELECT c.relname AS name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
               EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polname = 'tenant_isolation') AS has_policy,
               EXISTS (SELECT 1 FROM information_schema.columns col WHERE col.table_name = c.relname AND col.column_name = 'tenant_id' AND col.is_nullable = 'NO') AS has_tenant
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    SQL);

    $unprotected = collect($tables)
        ->reject(fn ($t) => in_array($t->name, Rls::GLOBAL_TABLES, true))
        ->reject(fn ($t) => $t->enabled && $t->forced && $t->has_policy && $t->has_tenant)
        ->pluck('name')->all();

    expect($unprotected)->toBe([])
        ->and(collect($tables)->pluck('name'))->toContain('journals', 'journal_lines', 'audit_events', 'outbox_messages');
});

it('isolates tenants: other tenants are invisible and cannot be written', function () {
    $a = LedgerFixture::create(slug: 'alpha');
    cashSale($a);
    $b = LedgerFixture::create(slug: 'beta');

    $context = app(TenantContext::class);
    expect($context->id())->toBe($b->tenantId)
        ->and(DB::table('journals')->count())->toBe(0)
        ->and(DB::table('companies')->pluck('id')->all())->toBe([$b->companyId])
        ->and(DB::table('accounts')->where('company_id', $a->companyId)->update(['name' => 'hacked']))->toBe(0);

    expect(fn () => DB::table('accounts')->insert([
        'id' => (string) Str::uuid7(), 'tenant_id' => $a->tenantId, 'company_id' => $a->companyId,
        'code' => '9999', 'name' => 'x', 'account_type' => 'asset', 'normal_balance' => 'debit',
    ]))->toThrow(QueryException::class, 'row-level security');

    $context->run($a->tenantId, fn () => expect(DB::table('journals')->count())->toBe(1));
});

it('fails closed without a tenant context', function () {
    $f = LedgerFixture::create();
    cashSale($f);
    app(TenantContext::class)->clear();

    expect(DB::table('journals')->count())->toBe(0)
        ->and(DB::table('audit_events')->count())->toBe(0);

    expect(fn () => DB::table('sequences')->insert([
        'id' => (string) Str::uuid7(), 'company_id' => $f->companyId, 'sequence_key' => 'x',
    ]))->toThrow(QueryException::class);
});

it('does not bleed context between sequential tenant jobs on one worker, on every tenant connection', function () {
    $a = LedgerFixture::create(slug: 'alpha');
    cashSale($a);
    $b = LedgerFixture::create(slug: 'beta');
    $context = app(TenantContext::class);
    $context->clear();

    $seen = [];
    foreach ([$a->tenantId, $b->tenantId, $a->tenantId] as $tenant) {
        $context->run($tenant, function () use (&$seen) {
            $seen[] = [
                DB::connection('pgsql')->table('journals')->count(),
                DB::connection('pgsql_audit')->table('companies')->count(),
                DB::connection('pgsql')->selectOne("SELECT current_setting('app.tenant_id') AS t")->t,
            ];
        });
        expect(DB::connection('pgsql')->selectOne("SELECT current_setting('app.tenant_id', true) AS t")->t)->toBe('')
            ->and(DB::connection('pgsql_audit')->selectOne("SELECT current_setting('app.tenant_id', true) AS t")->t)->toBe('');
    }

    expect($seen)->toBe([[1, 1, $a->tenantId], [0, 1, $b->tenantId], [1, 1, $a->tenantId]]);
});

it('re-applies the tenant GUC after a reconnect', function () {
    $f = LedgerFixture::create();
    cashSale($f);

    DB::reconnect('pgsql');

    expect(DB::table('journals')->count())->toBe(1);
});
