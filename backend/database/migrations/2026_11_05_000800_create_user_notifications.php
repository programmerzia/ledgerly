<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * In-app notifications (plan 3c.6): one row per person per event, filled from outbox messages. `dedupe_key` is what makes the
 * fan-out idempotent: `outbox:{message id}` for an outbox event, a stable key for a scheduled reminder. The same key for the
 * same person is stored once, so a relay that runs twice, or two overlapping scheduler runs, add nothing the second time.
 * A person reads only their own rows (the Query filters on the signed-in user), and tenant RLS keeps tenants apart.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('user_notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->uuid('user_id');
            $table->foreign('user_id')->references('id')->on('users')->cascadeOnDelete();
            $table->string('kind', 40);
            $table->string('title');
            $table->text('body')->nullable();
            $table->string('subject_type', 40)->nullable();
            $table->uuid('subject_id')->nullable();
            /** Path inside the company (for example `approvals` or `invoices/{id}`); the SPA adds the company. */
            $table->string('link', 200)->nullable();
            $table->string('dedupe_key', 160);
            $table->timestampTz('read_at')->nullable();
            $table->timestampTz('created_at');
            $table->unique(['user_id', 'dedupe_key']);
            $table->index(['user_id', 'company_id', 'id']);
        });
        DB::statement('CREATE INDEX user_notifications_unread ON user_notifications (user_id, company_id) WHERE read_at IS NULL');
        Rls::enable(DB::connection(), 'user_notifications');
    }

    public function down(): void
    {
        Schema::dropIfExists('user_notifications');
    }
};
