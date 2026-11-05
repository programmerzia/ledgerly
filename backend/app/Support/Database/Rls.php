<?php

declare(strict_types=1);

namespace App\Support\Database;

use Illuminate\Database\Connection;
use Illuminate\Database\Schema\Blueprint;

/**
 * Migration helpers for tenant isolation (13 §6). Registered as macros:
 *   Schema::enableRls('table')            fail-closed policy, tenant_id default, FORCE RLS
 *   $table->tenantColumn()                tenant_id uuid not null → tenants(id)
 *   $table->companyColumn()               company_id uuid + composite FK (tenant_id, company_id) → companies
 *   $table->companyScopedParent()         UNIQUE (tenant_id, company_id, id) for composite child FKs
 *   $table->companyRef('col', 'parents')  composite FK (tenant_id, company_id, col) → parents
 */
final class Rls
{
    public const string GUC = "NULLIF(current_setting('app.tenant_id', true), '')::uuid";

    /**
     * Tables with no tenant_id by design (13 §6). Everything else must have forced RLS;
     * tests/Database/RlsCoverageTest enforces this.
     */
    public const array GLOBAL_TABLES = [
        // reference data
        'currencies', 'chart_templates', 'menu_items',
        // platform identity: looked up before a tenant is known; access is scoped by user/tenant id in Queries
        'tenants', 'users', 'tenant_users', 'password_reset_tokens', 'personal_access_tokens',
        // Laravel infrastructure
        'migrations', 'jobs', 'job_batches', 'failed_jobs', 'cache', 'cache_locks', 'sessions',
        // platform aggregates (non-sensitive)
        'tenant_kpi_snapshots', 'tenant_deletions',
    ];

    public static function enable(Connection $connection, string $table): void
    {
        $guc = self::GUC;
        $connection->statement("ALTER TABLE {$table} ENABLE ROW LEVEL SECURITY");
        $connection->statement("ALTER TABLE {$table} FORCE ROW LEVEL SECURITY");
        $connection->statement("ALTER TABLE {$table} ALTER COLUMN tenant_id SET DEFAULT {$guc}");
        $connection->statement(
            "CREATE POLICY tenant_isolation ON {$table} USING (tenant_id = {$guc}) WITH CHECK (tenant_id = {$guc})"
        );
    }

    public static function tenantColumn(Blueprint $table): void
    {
        $table->uuid('tenant_id');
        $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
        $table->index('tenant_id');
    }

    public static function companyColumn(Blueprint $table): void
    {
        $table->uuid('company_id');
        $table->foreign(['tenant_id', 'company_id'])->references(['tenant_id', 'id'])->on('companies')->restrictOnDelete();
    }

    public static function companyRef(Blueprint $table, string $column, string $parent, bool $nullable = false): void
    {
        $col = $table->uuid($column);
        if ($nullable) {
            $col->nullable();
        }
        $table->foreign(['tenant_id', 'company_id', $column])
            ->references(['tenant_id', 'company_id', 'id'])->on($parent)->restrictOnDelete();
    }
}
