<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use App\Support\Database\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Audit chain (13 §14) and transactional outbox (13 §15). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('audit_chain_heads', function (Blueprint $table) {
            $table->uuid('tenant_id')->primary();
            $table->unsignedBigInteger('last_id')->nullable();
            $table->char('last_hash', 64)->nullable();
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
        });
        Rls::enable(DB::connection(), 'audit_chain_heads');

        Schema::create('audit_events', function (Blueprint $table) {
            $table->id();
            Rls::tenantColumn($table);
            $table->uuid('company_id')->nullable();
            $table->string('actor_type', 32);
            $table->uuid('actor_id')->nullable();
            $table->string('action', 64);
            $table->string('subject_type', 64)->nullable();
            $table->uuid('subject_id')->nullable();
            $table->jsonb('before')->nullable();
            $table->jsonb('after')->nullable();
            $table->jsonb('context')->nullable();
            $table->ipAddress('ip')->nullable();
            $table->text('user_agent')->nullable();
            $table->string('request_id', 64)->nullable();
            $table->timestampTz('occurred_at', 6);
            $table->text('canonical');
            $table->char('prev_hash', 64)->nullable();
            $table->char('hash', 64);
            $table->index(['tenant_id', 'occurred_at']);
            $table->index(['subject_type', 'subject_id']);
        });
        Rls::enable(DB::connection(), 'audit_events');

        Schema::create('audit_seals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->unsignedBigInteger('sealed_through_id');
            $table->char('tip_hash', 64);
            $table->timestampTz('sealed_at');
            $table->jsonb('external_receipt')->nullable();
        });
        Rls::enable(DB::connection(), 'audit_seals');

        Schema::create('outbox_messages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->string('type', 96);
            $table->jsonb('payload');
            $table->timestampTz('occurred_at', 6);
            $table->timestampTz('claimed_at')->nullable();
            $table->timestampTz('dispatched_at')->nullable();
            $table->smallInteger('attempts')->default(0);
        });
        DB::statement('CREATE INDEX outbox_messages_pending ON outbox_messages (claimed_at) WHERE dispatched_at IS NULL');
        Rls::enable(DB::connection(), 'outbox_messages');

        SqlFile::run(DB::connection(), 'audit_append_only.sql');
    }

    public function down(): void
    {
        Schema::dropIfExists('outbox_messages');
        Schema::dropIfExists('audit_seals');
        Schema::dropIfExists('audit_events');
        Schema::dropIfExists('audit_chain_heads');
        DB::unprepared('DROP FUNCTION IF EXISTS audit_append_only() CASCADE');
    }
};
