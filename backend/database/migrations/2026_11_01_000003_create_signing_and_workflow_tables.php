<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Signing events (ADR-0004) and approval workflows with their per-document snapshots (13 §10). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('signing_events', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->uuid('user_id');
            $table->enum('kind', ['success', 'failure', 'lockout', 'pin_changed']);
            $table->string('subject_type', 64)->nullable();
            $table->uuid('subject_id')->nullable();
            $table->ipAddress('ip')->nullable();
            $table->timestampTz('occurred_at', 6);
            $table->index(['user_id', 'occurred_at']);
            $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
        });
        Rls::enable(DB::connection(), 'signing_events');

        Schema::create('approval_workflows', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('document_type', 32);
            $table->string('name');
            // Which submitters it applies to: documents created by people, by API clients, or both.
            $table->enum('source', ['any', 'user', 'api'])->default('any');
            $table->bigInteger('min_amount')->default(0);
            $table->bigInteger('max_amount')->nullable();
            $table->jsonb('steps'); // [{"role": "Approver", "count": 1}, ...] in order
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->index(['company_id', 'document_type', 'is_active']);
        });
        DB::statement('ALTER TABLE approval_workflows ADD CONSTRAINT approval_workflows_amounts CHECK (min_amount >= 0 AND (max_amount IS NULL OR max_amount > min_amount))');
        Rls::enable(DB::connection(), 'approval_workflows');

        // One row per required signature: step order × slot within the step. Snapshotted at submit,
        // so a workflow edited later never changes an in-flight document.
        Schema::create('approval_requests', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('document_type', 32);
            $table->uuid('document_id');
            $table->uuid('workflow_id')->nullable();
            $table->smallInteger('step');
            $table->smallInteger('slot')->default(1);
            $table->string('role', 64);
            $table->enum('status', ['pending', 'approved', 'returned', 'cancelled'])->default('pending');
            $table->uuid('requested_by')->nullable();
            $table->timestampTz('requested_at');
            $table->uuid('decided_by')->nullable();
            $table->timestampTz('decided_at')->nullable();
            $table->text('comment')->nullable();
            $table->uuid('signed_by')->nullable();
            $table->timestampTz('signed_at')->nullable();
            $table->char('signature_hash', 64)->nullable();
            $table->index(['company_id', 'status', 'requested_at']);
            $table->index(['document_type', 'document_id']);
        });
        DB::statement('CREATE UNIQUE INDEX approval_requests_open_slot ON approval_requests (document_type, document_id, step, slot) WHERE status = \'pending\'');
        DB::statement('ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_maker_checker CHECK (decided_by IS DISTINCT FROM requested_by OR decided_by IS NULL)');
        Rls::enable(DB::connection(), 'approval_requests');
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_requests');
        Schema::dropIfExists('approval_workflows');
        Schema::dropIfExists('signing_events');
    }
};
