<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use App\Support\Database\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Idempotency keys (13 §11): the row is the lock for a retried request. Scoped per tenant and
 * actor, so two clients can never collide on the same key. Also refreshes the sysops functions
 * (the outbox claim now stops after 20 attempts) and adds the hourly purge.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('idempotency_keys', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->string('actor_type', 32);
            $table->uuid('actor_id');
            $table->string('key', 255);
            $table->char('request_hash', 64);
            $table->enum('state', ['pending', 'committed', 'completed']);
            $table->timestampTz('lease_until');
            $table->string('subject_type', 64)->nullable();
            $table->uuid('subject_id')->nullable();
            $table->smallInteger('response_status')->nullable();
            $table->text('response_body')->nullable();
            $table->timestampTz('created_at')->useCurrent();
            $table->unique(['tenant_id', 'actor_type', 'actor_id', 'key']);
            $table->index('created_at');
        });
        Rls::enable(DB::connection(), 'idempotency_keys');

        $db = DB::connection();
        $db->statement('GRANT DELETE ON idempotency_keys TO ledgerly_sysops');
        $db->statement('SET LOCAL ROLE ledgerly_sysops');
        SqlFile::run($db, 'sysops_functions.sql');
        SqlFile::run($db, 'sysops_idempotency.sql');
        $db->statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS sysops.purge_idempotency_keys()');
        Schema::dropIfExists('idempotency_keys');
    }
};
