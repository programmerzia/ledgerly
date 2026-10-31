<?php

declare(strict_types=1);

use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

/*
 * 13 §6: the app role reaches across tenants only through the sysops SECURITY DEFINER functions,
 * and those return only what they should.
 */

function outboxMessage(LedgerFixture $f, string $occurredAt, array $extra = []): string
{
    return app(TenantContext::class)->run($f->tenantId, function () use ($f, $occurredAt, $extra): string {
        $id = (string) Str::uuid7();
        DB::table('outbox_messages')->insert([
            'id' => $id, 'tenant_id' => $f->tenantId, 'type' => 'test.event', 'payload' => '{}', 'occurred_at' => $occurredAt, ...$extra,
        ]);

        return $id;
    });
}

it('defines each function as SECURITY DEFINER, owned by sysops, with a fixed search_path and no PUBLIC execute', function (): void {
    $functions = DB::select(<<<'SQL'
        SELECT p.proname AS name, p.prosecdef AS definer, pg_get_userbyid(p.proowner) AS owner,
               array_to_string(p.proconfig, ',') AS config,
               has_function_privilege('ledgerly_report', p.oid, 'EXECUTE') AS report_can,
               has_function_privilege('ledgerly_platform', p.oid, 'EXECUTE') AS platform_can,
               has_function_privilege('ledgerly_app', p.oid, 'EXECUTE') AS app_can
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'sysops' ORDER BY p.proname
    SQL);

    expect(array_column($functions, 'name'))->toBe(['claim_outbox_batch', 'invitation_by_token_hash', 'purge_idempotency_keys', 'tenants_due_for']);
    foreach ($functions as $fn) {
        expect($fn->definer)->toBeTrue()
            ->and($fn->owner)->toBe('ledgerly_sysops')
            ->and($fn->config)->toBe('search_path=pg_catalog, pg_temp')
            ->and($fn->app_can)->toBeTrue()
            ->and($fn->report_can)->toBeFalse()
            ->and($fn->platform_can)->toBeFalse();
    }
});

it('finds an invitation by token hash without a tenant context, returning only its id and tenant', function (): void {
    $f = LedgerFixture::create(slug: 'alpha');
    $id = (string) Str::uuid7();
    DB::table('invitations')->insert([
        'id' => $id, 'tenant_id' => $f->tenantId, 'email' => 'new@alpha.test', 'invited_by' => $f->userId,
        'token_hash' => hash('sha256', 'raw-token'), 'expires_at' => now()->addDay(),
    ]);
    app(TenantContext::class)->clear();

    expect(DB::table('invitations')->count())->toBe(0);
    $rows = DB::select('SELECT * FROM sysops.invitation_by_token_hash(?)', [hash('sha256', 'raw-token')]);
    expect($rows)->toHaveCount(1)
        ->and((array) $rows[0])->toBe(['invitation_id' => $id, 'tenant_id' => $f->tenantId])
        ->and(DB::select('SELECT * FROM sysops.invitation_by_token_hash(?)', [hash('sha256', 'other')]))->toBe([]);
});

it('claims undispatched outbox messages across tenants, oldest first, once per minute', function (): void {
    $a = LedgerFixture::create(slug: 'alpha');
    $b = LedgerFixture::create(slug: 'beta');
    $old = outboxMessage($b, '2026-10-31 09:00:00');
    $new = outboxMessage($a, '2026-10-31 10:00:00');
    outboxMessage($a, '2026-10-31 08:00:00', ['dispatched_at' => now()]);
    $stale = outboxMessage($a, '2026-10-31 07:00:00', ['claimed_at' => now()->subMinutes(5), 'attempts' => 1]);
    outboxMessage($b, '2026-10-31 06:00:00', ['claimed_at' => now()->subSeconds(10), 'attempts' => 1]);
    app(TenantContext::class)->clear();

    $claimed = DB::select('SELECT * FROM sysops.claim_outbox_batch(10)');
    expect(array_map(fn ($r) => [$r->message_id, $r->tenant_id], $claimed))->toEqualCanonicalizing([
        [$stale, $a->tenantId], [$old, $b->tenantId], [$new, $a->tenantId],
    ]);
    // Claimed rows are skipped until the claim is a minute old.
    expect(DB::select('SELECT * FROM sysops.claim_outbox_batch(10)'))->toBe([]);

    app(TenantContext::class)->set($a->tenantId);
    expect(DB::table('outbox_messages')->where('id', $stale)->value('attempts'))->toBe(2);
});

it('lists live tenants for scheduled jobs, keyset-paginated', function (): void {
    $ids = collect(['alpha', 'beta', 'gamma', 'delta'])->map(fn ($s) => LedgerFixture::create(slug: $s)->tenantId);
    app(TenantContext::class)->clear();
    DB::connection('pgsql_owner')->table('tenants')->where('id', $ids[3])->update(['lifecycle' => 'cancelled']);
    $live = $ids->take(3)->sort()->values()->all();

    $page = fn (?string $after) => array_column(
        DB::select('SELECT * FROM sysops.tenants_due_for(?, ?, 2)', ['recurring_journals', $after]), 'tenant_id',
    );
    expect($page(null))->toBe(array_slice($live, 0, 2))
        ->and($page($live[1]))->toBe([$live[2]])
        ->and($page($live[2]))->toBe([]);
});

it('keeps the sysops schema closed to the app role except through the functions', function (): void {
    expect(fn () => DB::statement('CREATE FUNCTION sysops.evil() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'))
        ->toThrow(QueryException::class);
});
