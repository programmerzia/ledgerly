<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use App\Support\Database\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Webhooks over the outbox (13 §15, plan 2.16). Endpoints belong to the organisation (tenant), like
 * API clients. `secret` holds the Laravel-encrypted signing secret. A delivery is one outbox message
 * for one endpoint: UNIQUE (endpoint_id, message_id) makes at-least-once relay idempotent. Retries are
 * driven by `next_retry_at` and a sweep, never by long-delayed queue jobs.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('webhook_endpoints', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->string('url', 2048);
            $table->string('description')->nullable();
            $table->text('secret');
            $table->boolean('is_active')->default(true);
            $table->timestampTz('disabled_at')->nullable();
            $table->string('disabled_reason', 16)->nullable();
            $table->timestampTz('secret_rotated_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'id']);
        });
        DB::statement('ALTER TABLE webhook_endpoints ADD COLUMN events text[] NOT NULL');
        DB::statement("ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_reason_check CHECK (disabled_reason IS NULL OR disabled_reason IN ('manual', 'failures', 'gone'))");
        DB::statement('ALTER TABLE webhook_endpoints ADD CONSTRAINT webhook_endpoints_events_check CHECK (cardinality(events) > 0)');
        Rls::enable(DB::connection(), 'webhook_endpoints');

        Schema::create('webhook_deliveries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->uuid('endpoint_id');
            $table->uuid('message_id');
            $table->string('event_type', 96);
            $table->jsonb('payload');
            $table->enum('status', ['pending', 'delivered', 'failed', 'cancelled'])->default('pending');
            $table->smallInteger('attempts')->default(0);
            $table->timestampTz('window_started_at');
            $table->timestampTz('next_retry_at')->nullable();
            $table->timestampTz('last_attempt_at')->nullable();
            $table->timestampTz('delivered_at')->nullable();
            $table->smallInteger('response_code')->nullable();
            $table->string('response_snippet', 1024)->nullable();
            $table->string('error', 64)->nullable();
            $table->timestampsTz();
            $table->foreign(['tenant_id', 'endpoint_id'])->references(['tenant_id', 'id'])->on('webhook_endpoints')->restrictOnDelete();
            $table->unique(['endpoint_id', 'message_id']);
            $table->index(['endpoint_id', 'id']);
        });
        DB::statement("CREATE INDEX webhook_deliveries_due ON webhook_deliveries (next_retry_at) WHERE status = 'pending'");
        Rls::enable(DB::connection(), 'webhook_deliveries');

        $db = DB::connection();
        $db->statement('SET LOCAL ROLE ledgerly_sysops');
        SqlFile::run($db, 'sysops_webhooks.sql');
        $db->statement('RESET ROLE');
    }

    public function down(): void
    {
        DB::statement('DROP FUNCTION IF EXISTS sysops.webhook_deliveries_due(timestamptz, integer)');
        Schema::dropIfExists('webhook_deliveries');
        Schema::dropIfExists('webhook_endpoints');
    }
};
