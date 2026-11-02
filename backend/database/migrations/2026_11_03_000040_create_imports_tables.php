<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Data imports (plan 2.18, 05 §12). An import is a parsed upload: the file itself is never stored, only its rows (`import_rows.cells`,
 * header => text) until someone purges them. `unique (import_id, row_number)` is what makes a re-run or a job retry skip rows already
 * applied. Opening balances are one journal: the partial unique index lets a company hold a single posted `opening` journal until it is
 * reversed, even when two imports race.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('imports', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->enum('kind', ['contacts', 'accounts', 'opening_balances', 'invoices', 'bank_lines']);
            $table->enum('status', ['uploaded', 'mapped', 'previewed', 'queued', 'applying', 'completed', 'failed'])->default('uploaded');
            $table->string('source_name', 255)->nullable();
            $table->enum('source_format', ['csv', 'xlsx']);
            $table->jsonb('columns');
            $table->jsonb('suggested_mapping')->nullable();
            $table->string('suggestion_source', 16)->nullable();
            $table->jsonb('mapping')->nullable();
            $table->jsonb('options');
            $table->integer('rows_total')->default(0);
            $table->integer('rows_valid')->default(0);
            $table->integer('rows_invalid')->default(0);
            $table->integer('rows_applied')->default(0);
            $table->integer('rows_failed')->default(0);
            $table->jsonb('errors')->nullable();
            $table->jsonb('result')->nullable();
            $table->uuid('created_by');
            $table->uuid('requested_by')->nullable();
            $table->uuid('signed_by')->nullable();
            $table->timestampTz('signed_at')->nullable();
            $table->timestampTz('queued_at')->nullable();
            $table->timestampTz('started_at')->nullable();
            $table->timestampTz('finished_at')->nullable();
            $table->timestampTz('rows_purged_at')->nullable();
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'kind', 'status']);
            $table->foreign('created_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('requested_by')->references('id')->on('users')->restrictOnDelete();
            $table->foreign('signed_by')->references('id')->on('users')->restrictOnDelete();
        });
        Rls::enable(DB::connection(), 'imports');

        Schema::create('import_rows', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'import_id', 'imports');
            $table->integer('row_number');
            $table->jsonb('cells');
            $table->enum('status', ['pending', 'valid', 'invalid', 'applied', 'failed'])->default('pending');
            $table->jsonb('errors')->nullable();
            $table->jsonb('result')->nullable();
            $table->timestampTz('applied_at')->nullable();
            $table->timestampsTz();
            // The guarantee: a row is applied at most once, however often the import is run.
            $table->unique(['import_id', 'row_number']);
            $table->index(['import_id', 'status']);
        });
        Rls::enable(DB::connection(), 'import_rows');

        DB::statement("CREATE UNIQUE INDEX journals_one_posted_opening ON journals (company_id) WHERE journal_type = 'opening' AND status = 'posted'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS journals_one_posted_opening');
        Schema::dropIfExists('import_rows');
        Schema::dropIfExists('imports');
    }
};
