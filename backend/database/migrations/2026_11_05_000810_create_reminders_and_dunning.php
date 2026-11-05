<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Approval SLA reminders and overdue-invoice reminders (plan 3c.7).
 *
 * - `approval_workflows.remind_after_hours`: optional; a document waiting on its current step for that long is chased, and then
 *   again once per further interval.
 * - `approval_reminders`: one row per (document, step, interval number). The unique key is what keeps two overlapping runs, or a
 *   run repeated after a crash, from reminding twice for the same interval.
 * - `company_settings.dunning_enabled` (off by default), `dunning_stages` (days after the due date, with the wording) and
 *   `contacts.dunning_opt_out`.
 * - `dunning_sends`: one row per (invoice, stage), unique in the database. It is the record that a stage was used, written in
 *   the same transaction as the send-log row it points to.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('approval_workflows', function (Blueprint $table) {
            $table->unsignedSmallInteger('remind_after_hours')->nullable();
        });
        DB::statement('ALTER TABLE approval_workflows ADD CONSTRAINT approval_workflows_remind_range CHECK (remind_after_hours IS NULL OR remind_after_hours BETWEEN 1 AND 720)');

        Schema::create('approval_reminders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('document_type', 40);
            $table->uuid('document_id');
            $table->unsignedSmallInteger('step');
            $table->unsignedInteger('sequence');
            $table->unsignedSmallInteger('recipients')->default(0);
            $table->timestampTz('sent_at');
            $table->unique(['document_type', 'document_id', 'step', 'sequence']);
        });
        Rls::enable(DB::connection(), 'approval_reminders');

        Schema::table('company_settings', function (Blueprint $table) {
            $table->boolean('dunning_enabled')->default(false);
        });
        Schema::table('contacts', function (Blueprint $table) {
            $table->boolean('dunning_opt_out')->default(false);
        });

        Schema::create('dunning_stages', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->unsignedSmallInteger('days_after_due');
            $table->string('subject');
            $table->text('body');
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
        });
        DB::statement('ALTER TABLE dunning_stages ADD CONSTRAINT dunning_stages_days CHECK (days_after_due BETWEEN 1 AND 365)');
        // Deferred, so a save that swaps two stages' days inside one transaction is not refused halfway.
        DB::statement('ALTER TABLE dunning_stages ADD CONSTRAINT dunning_stages_company_days_unique UNIQUE (company_id, days_after_due) DEFERRABLE INITIALLY DEFERRED');
        Rls::enable(DB::connection(), 'dunning_stages');

        Schema::create('dunning_sends', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'invoice_id', 'invoices');
            $table->uuid('stage_id');
            $table->foreign(['tenant_id', 'company_id', 'stage_id'])->references(['tenant_id', 'company_id', 'id'])->on('dunning_stages')->restrictOnDelete();
            $table->uuid('document_send_id')->nullable();
            /** The company's own date the stage was used on. */
            $table->date('sent_on');
            $table->timestampTz('created_at');
            $table->unique(['invoice_id', 'stage_id']);
        });
        Rls::enable(DB::connection(), 'dunning_sends');
    }

    public function down(): void
    {
        Schema::dropIfExists('dunning_sends');
        Schema::dropIfExists('dunning_stages');
        Schema::table('contacts', fn (Blueprint $t) => $t->dropColumn('dunning_opt_out'));
        Schema::table('company_settings', fn (Blueprint $t) => $t->dropColumn('dunning_enabled'));
        Schema::dropIfExists('approval_reminders');
        DB::statement('ALTER TABLE approval_workflows DROP CONSTRAINT IF EXISTS approval_workflows_remind_range');
        Schema::table('approval_workflows', fn (Blueprint $t) => $t->dropColumn('remind_after_hours'));
    }
};
