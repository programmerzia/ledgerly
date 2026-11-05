<?php

declare(strict_types=1);

use App\Actions\Organisation\SeedCompanyRoles;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Support\LedgerFixture;

/* `document_sends` (plan 3c.5): tenant isolation, the status CHECK, and the `documents.send` backfill that leaves other rights alone. */

beforeEach(function (): void {
    $this->f = LedgerFixture::create('USD', 'acme');
    app(SeedCompanyRoles::class)->handle($this->f->actor, $this->f->companyId);
});

function sendRow(object $f, string $status = 'queued'): array
{
    return [
        'id' => (string) Str::uuid7(), 'tenant_id' => $f->tenantId, 'company_id' => $f->companyId, 'document_type' => 'invoice', 'document_id' => (string) Str::uuid7(),
        'recipients' => '["a@b.example"]', 'subject' => 's', 'body' => 'b', 'attachment_name' => 'x.pdf', 'status' => $status, 'queued_at' => now(),
    ];
}

it('keeps sends inside their tenant and refuses a status outside queued, sent and failed', function (): void {
    $other = LedgerFixture::create('USD', 'other');
    app(TenantContext::class)->run($this->f->tenantId, function (): void {
        DB::table('document_sends')->insert(sendRow($this->f));
        expect(fn () => DB::table('document_sends')->insert(sendRow($this->f, 'bounced')))->toThrow(QueryException::class);
        // The tenant column defaults from the context, and a row for another tenant cannot be written.
        expect(fn () => DB::table('document_sends')->insert(['tenant_id' => (string) Str::uuid7()] + sendRow($this->f)))->toThrow(QueryException::class);
    });
    expect(app(TenantContext::class)->run($other->tenantId, fn () => DB::table('document_sends')->count()))->toBe(0)
        ->and(app(TenantContext::class)->run($this->f->tenantId, fn () => DB::table('document_sends')->count()))->toBe(1);
});

/** @return list<string> */
function roleHolders(string $tenantId, string $permission): array
{
    return app(TenantContext::class)->run($tenantId, fn () => DB::table('role_has_permissions as rp')->join('roles as r', 'r.id', '=', 'rp.role_id')->join('permissions as p', 'p.id', '=', 'rp.permission_id')
        ->where('p.name', $permission)->pluck('r.name')->unique()->sort()->values()->all());
}

it('gives an existing company the documents.send permission without touching any other right, and changes nothing when run twice', function (): void {
    $tenant = $this->f->tenantId;
    $expected = roleHolders($tenant, 'documents.send');
    expect($expected)->toBe(['Accountant', 'Finance Manager', 'Owner', 'Sales Assistant']);

    // As if the company predates the permission, and a tenant had also taken a right away from the Accountant.
    app(TenantContext::class)->run($tenant, function (): void {
        $id = DB::table('permissions')->where('name', 'documents.send')->value('id');
        DB::table('role_has_permissions')->where('permission_id', $id)->delete();
        DB::table('permissions')->where('id', $id)->delete();
        $journalCreate = DB::table('permissions')->where('name', 'journals.create')->value('id');
        DB::table('role_has_permissions')->where('permission_id', $journalCreate)->whereIn('role_id', DB::table('roles')->where('name', 'Accountant')->pluck('id'))->delete();
    });
    expect(roleHolders($tenant, 'documents.send'))->toBe([]);

    $migration = require base_path('database/migrations/2026_11_05_000201_backfill_document_send_permission.php');
    $migration->up();
    $migration->up();

    expect(roleHolders($tenant, 'documents.send'))->toBe($expected)
        ->and(roleHolders($tenant, 'journals.create'))->not->toContain('Accountant');
});
