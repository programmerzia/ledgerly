<?php

declare(strict_types=1);

use App\Domain\Organisation\PermissionMatrix;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Roles can be edited by their company (plan 3c.25), so a role needs to say what it is:
 *  - `is_system`: one of the seven seeded roles. Its name is fixed; Owner is locked completely; the others can be edited and reset.
 *  - `permissions_edited`: a system role whose permissions a person changed. SeedCompanyRoles and permission backfills leave such a role
 *    alone; an unedited system role keeps following the matrix.
 * Existing seeded roles are marked by name. A role someone created by hand under a seeded name before this change cannot be told apart
 * and is treated as the seeded one (they are the same by the unique name per company).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('roles', function (Blueprint $table) {
            $table->boolean('is_system')->default(false);
            $table->boolean('permissions_edited')->default(false);
        });

        $names = implode(', ', array_fill(0, count(PermissionMatrix::ROLES), '?'));
        // Forced RLS applies to the migration role too, so this runs once per tenant under that tenant's context.
        foreach (DB::table('tenants')->pluck('id') as $tenantId) {
            DB::statement("SELECT set_config('app.tenant_id', ?, false)", [$tenantId]);
            DB::statement("UPDATE roles SET is_system = true WHERE guard_name = 'web' AND name IN ({$names})", PermissionMatrix::ROLES);
        }
        DB::statement("SELECT set_config('app.tenant_id', '', false)");
    }

    public function down(): void
    {
        Schema::table('roles', function (Blueprint $table) {
            $table->dropColumn(['is_system', 'permissions_edited']);
        });
    }
};
