<?php

declare(strict_types=1);

use App\Domain\Organisation\PermissionMatrix;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Roles are seeded when a company is created, so companies that already exist need `documents.share` (plan 3c.7b, 13 §7): making
 * and revoking the online link of an invoice. Only that name is touched, and only for the roles the matrix gives it to: a role a
 * tenant has otherwise changed keeps every other right as it is, and a role the matrix does not name is left alone. Runs per
 * tenant under that tenant's context, because forced RLS applies to the migration role too. Safe to run twice.
 */
return new class extends Migration
{
    private const string PERMISSION = 'documents.share';

    public function up(): void
    {
        foreach (DB::table('tenants')->pluck('id') as $tenantId) {
            DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$tenantId]);
            DB::statement(
                "INSERT INTO permissions (id, tenant_id, name, guard_name, created_at, updated_at)
                 VALUES (gen_random_uuid(), ?, ?, 'web', now(), now()) ON CONFLICT (tenant_id, name, guard_name) DO NOTHING",
                [$tenantId, self::PERMISSION],
            );
            foreach (PermissionMatrix::ROLES as $role) {
                if (! in_array(self::PERMISSION, PermissionMatrix::forRole($role), true)) {
                    continue;
                }
                DB::statement(
                    "INSERT INTO role_has_permissions (tenant_id, permission_id, role_id)
                     SELECT r.tenant_id, p.id, r.id FROM roles r JOIN permissions p ON p.tenant_id = r.tenant_id AND p.name = ? AND p.guard_name = r.guard_name
                     WHERE r.name = ? AND r.guard_name = 'web' ON CONFLICT DO NOTHING",
                    [self::PERMISSION, $role],
                );
            }
        }
        DB::statement("SELECT set_config('app.tenant_id', '', false)");
    }

    public function down(): void
    {
        // The permission stays: removing it could strip a right a tenant granted on purpose.
    }
};
