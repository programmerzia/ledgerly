<?php

declare(strict_types=1);

use App\Support\Database\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Practice overview figures (13 §7, plan 2.19): one row per company with non-sensitive aggregates only.
 * Platform table, no RLS (allowlisted in Rls::GLOBAL_TABLES), so the app role gets NO privileges on it at all.
 * It is written and read only through the `sysops` SECURITY DEFINER functions, which tie writes to the caller's
 * own tenant context and reads to the caller's memberships.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenant_kpi_snapshots', function (Blueprint $table) {
            $table->uuid('tenant_id');
            $table->uuid('company_id');
            $table->string('company_name', 255);
            $table->char('base_currency', 3);
            $table->bigInteger('open_ar')->default(0);
            $table->bigInteger('open_ap')->default(0);
            $table->integer('pending_approvals')->default(0);
            $table->date('last_closed_period')->nullable();
            $table->jsonb('period_states')->default('{}');
            $table->timestampTz('dirty_at', 6)->nullable();
            $table->timestampTz('refreshed_at', 6)->nullable();
            $table->primary(['tenant_id', 'company_id']);
            $table->foreign('tenant_id')->references('id')->on('tenants')->cascadeOnDelete();
        });
        DB::statement('CREATE INDEX tenant_kpi_snapshots_dirty ON tenant_kpi_snapshots (dirty_at) WHERE dirty_at IS NOT NULL');

        $db = DB::connection();
        $db->statement('REVOKE ALL ON tenant_kpi_snapshots FROM PUBLIC, ledgerly_app, ledgerly_report, ledgerly_platform');
        $db->statement('GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_kpi_snapshots TO ledgerly_sysops');
        $db->statement('SET LOCAL ROLE ledgerly_sysops');
        SqlFile::run($db, 'sysops_kpi.sql');
        $db->statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS sysops.practice_overview(uuid)');
        DB::statement('DROP FUNCTION IF EXISTS sysops.store_kpi_snapshots(uuid, timestamptz, jsonb)');
        DB::statement('DROP FUNCTION IF EXISTS sysops.kpi_dirty_tenants(timestamptz, integer)');
        DB::statement('DROP FUNCTION IF EXISTS sysops.mark_kpi_dirty(uuid)');
        Schema::dropIfExists('tenant_kpi_snapshots');
    }
};
