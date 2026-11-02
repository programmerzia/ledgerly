<?php

declare(strict_types=1);

use App\Domain\Organisation\PermissionMatrix;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Roles are seeded when a company is created, so companies that already exist need the procurement permissions added
 * (13 §7). Only the new names are touched: a role a tenant has otherwise changed stays as it is. Runs per tenant
 * under that tenant's context, because forced RLS applies to the migration role too. Safe to run twice.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('tenants')->pluck('id') as $tenantId) {
            DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$tenantId]);
            foreach (PermissionMatrix::ROLES as $role) {
                $names = array_values(array_filter(PermissionMatrix::forRole($role), fn (string $p) => PermissionMatrix::isProcurement($p)));
                foreach ($names as $name) {
                    DB::statement(
                        "INSERT INTO permissions (id, tenant_id, name, guard_name, created_at, updated_at)
                         VALUES (gen_random_uuid(), ?, ?, 'web', now(), now()) ON CONFLICT (tenant_id, name, guard_name) DO NOTHING",
                        [$tenantId, $name],
                    );
                    DB::statement(
                        "INSERT INTO role_has_permissions (tenant_id, permission_id, role_id)
                         SELECT r.tenant_id, p.id, r.id FROM roles r JOIN permissions p ON p.tenant_id = r.tenant_id AND p.name = ? AND p.guard_name = r.guard_name
                         WHERE r.name = ? AND r.guard_name = 'web' ON CONFLICT DO NOTHING",
                        [$name, $role],
                    );
                }
            }
        }
        DB::statement("SELECT set_config('app.tenant_id', '', false)");
    }

    public function down(): void
    {
        // Permissions stay: removing them could strip rights a tenant granted on purpose.
    }
};
