<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Recurring schedules (doc 14 E2, 05 §6 `recurring_journals`). A schedule points at a posted template document
 * (an invoice or bill, or a manual journal) and, on each due date, creates a draft copy dated on that occurrence.
 * `recurring_runs` records one row per occurrence: its unique key is what stops a date being generated twice, even when
 * two workers run the same schedule at once. Nothing here posts anything.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('recurring_invoices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('name');
            Rls::companyRef($table, 'template_invoice_id', 'invoices');
            $this->scheduleColumns($table);
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'is_active', 'next_date']);
        });
        $this->checks('recurring_invoices');
        Rls::enable(DB::connection(), 'recurring_invoices');

        Schema::create('recurring_journals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('name');
            Rls::companyRef($table, 'template_journal_id', 'journals');
            $this->scheduleColumns($table);
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'is_active', 'next_date']);
        });
        $this->checks('recurring_journals');
        Rls::enable(DB::connection(), 'recurring_journals');

        Schema::create('recurring_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->enum('schedule_type', ['recurring_invoice', 'recurring_journal']);
            $table->uuid('schedule_id');
            $table->date('occurrence_date');
            $table->string('document_type', 16);
            $table->uuid('document_id');
            $table->enum('status', ['drafted', 'submitted', 'submit_failed'])->default('drafted');
            $table->string('note', 500)->nullable();
            $table->timestampsTz();
            // The guarantee: one document per schedule and occurrence date.
            $table->unique(['schedule_type', 'schedule_id', 'occurrence_date']);
            $table->index(['company_id', 'schedule_type', 'schedule_id']);
        });
        Rls::enable(DB::connection(), 'recurring_runs');
    }

    public function down(): void
    {
        Schema::dropIfExists('recurring_runs');
        Schema::dropIfExists('recurring_journals');
        Schema::dropIfExists('recurring_invoices');
    }

    private function scheduleColumns(Blueprint $table): void
    {
        $table->enum('frequency', ['monthly', 'quarterly', 'annual']);
        // Day of the month the schedule was set up on; short months use their last day, but the next month goes back to it.
        $table->smallInteger('anchor_day');
        $table->date('next_date');
        $table->date('end_date')->nullable();
        $table->uuid('owner_id');
        $table->boolean('is_active')->default(true);
        $table->date('last_run_on')->nullable();
        $table->string('last_error', 500)->nullable();
        $table->integer('lock_version')->default(0);
        $table->timestampsTz();
        $table->foreign('owner_id')->references('id')->on('users')->restrictOnDelete();
    }

    private function checks(string $table): void
    {
        DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_anchor_check CHECK (anchor_day BETWEEN 1 AND 31)");
        DB::statement("ALTER TABLE {$table} ADD CONSTRAINT {$table}_end_check CHECK (end_date IS NULL OR end_date >= next_date OR NOT is_active)");
    }
};
