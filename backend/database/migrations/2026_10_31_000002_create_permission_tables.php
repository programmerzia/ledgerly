<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * spatie/laravel-permission tables, tenant-owned with forced RLS (13 §6, §7). Team = company.
 * Permissions are tenant-wide names; roles and assignments belong to one company.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('permissions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->string('name');
            $table->string('guard_name');
            $table->timestampsTz();
            $table->unique(['tenant_id', 'name', 'guard_name']);
            $table->unique(['tenant_id', 'id']);
        });
        Rls::enable(DB::connection(), 'permissions');

        Schema::create('roles', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('name');
            $table->string('guard_name');
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'name', 'guard_name']);
            $table->unique(['tenant_id', 'id']);
        });
        Rls::enable(DB::connection(), 'roles');

        Schema::create('role_has_permissions', function (Blueprint $table) {
            Rls::tenantColumn($table);
            $table->uuid('permission_id');
            $table->uuid('role_id');
            $table->primary(['permission_id', 'role_id']);
            $table->foreign(['tenant_id', 'permission_id'])->references(['tenant_id', 'id'])->on('permissions')->cascadeOnDelete();
            $table->foreign(['tenant_id', 'role_id'])->references(['tenant_id', 'id'])->on('roles')->cascadeOnDelete();
        });
        Rls::enable(DB::connection(), 'role_has_permissions');

        Schema::create('model_has_permissions', function (Blueprint $table) {
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->uuid('permission_id');
            $table->string('model_type');
            $table->uuid('model_id');
            $table->index(['model_id', 'model_type']);
            $table->primary(['company_id', 'permission_id', 'model_id', 'model_type']);
            $table->foreign(['tenant_id', 'permission_id'])->references(['tenant_id', 'id'])->on('permissions')->cascadeOnDelete();
        });
        Rls::enable(DB::connection(), 'model_has_permissions');

        Schema::create('model_has_roles', function (Blueprint $table) {
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->uuid('role_id');
            $table->string('model_type');
            $table->uuid('model_id');
            $table->index(['model_id', 'model_type']);
            $table->primary(['company_id', 'role_id', 'model_id', 'model_type']);
            $table->foreign(['tenant_id', 'role_id'])->references(['tenant_id', 'id'])->on('roles')->cascadeOnDelete();
        });
        Rls::enable(DB::connection(), 'model_has_roles');
    }

    public function down(): void
    {
        Schema::dropIfExists('model_has_roles');
        Schema::dropIfExists('model_has_permissions');
        Schema::dropIfExists('role_has_permissions');
        Schema::dropIfExists('roles');
        Schema::dropIfExists('permissions');
    }
};
