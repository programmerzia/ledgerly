<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use App\Support\Database\SqlFile;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Ledger core (05 §6, 13 §9, §22). Posted rows are protected by database/sql/ledger_triggers.sql. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('journals', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'fiscal_period_id', 'fiscal_periods', nullable: true);
            $table->enum('journal_type', ['manual', 'sales', 'purchase', 'receipt', 'payment', 'bank', 'fx', 'depreciation', 'closing', 'adjustment', 'reversal', 'opening']);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'posted', 'reversed', 'void'])->default('draft');
            $table->date('journal_date');
            $table->timestampTz('posted_at')->nullable();
            $table->string('reference')->nullable();
            $table->text('memo')->nullable();
            $table->string('source_type', 64)->nullable();
            $table->uuid('source_id')->nullable();
            $table->uuid('reversal_of_id')->nullable();
            $table->uuid('reversed_by_id')->nullable();
            $table->bigInteger('total_debit')->default(0);
            $table->bigInteger('total_credit')->default(0);
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->uuid('posted_by')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'number']);
            $table->index(['company_id', 'journal_date']);
            $table->index(['company_id', 'status']);
            $table->index(['source_type', 'source_id']);
        });
        Schema::table('journals', function (Blueprint $table) {
            $table->foreign(['tenant_id', 'company_id', 'reversal_of_id'])->references(['tenant_id', 'company_id', 'id'])->on('journals');
            $table->foreign(['tenant_id', 'company_id', 'reversed_by_id'])->references(['tenant_id', 'company_id', 'id'])->on('journals');
        });
        DB::statement('ALTER TABLE journals ADD CONSTRAINT journals_maker_checker CHECK (approved_by IS DISTINCT FROM created_by OR approved_by IS NULL)');
        DB::statement("ALTER TABLE journals ADD CONSTRAINT journals_posted_complete CHECK (status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND fiscal_period_id IS NOT NULL AND posted_at IS NOT NULL))");
        Rls::enable(DB::connection(), 'journals');

        Schema::create('journal_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'journal_id', 'journals');
            $table->smallInteger('line_no');
            Rls::companyRef($table, 'account_id', 'accounts');
            $table->bigInteger('debit')->default(0);
            $table->bigInteger('credit')->default(0);
            $table->char('currency', 3);
            $table->decimal('fx_rate', 20, 8)->default(1);
            $table->bigInteger('amount_fc');
            for ($p = 1; $p <= 8; $p++) {
                Rls::companyRef($table, "dim{$p}_value_id", 'dimension_values', nullable: true);
            }
            $table->text('description')->nullable();
            $table->uuid('contact_id')->nullable();
            $table->uuid('tax_code_id')->nullable();
            $table->date('due_date')->nullable();
            $table->timestampsTz();
            $table->unique(['journal_id', 'line_no']);
            $table->index(['company_id', 'account_id', 'journal_id']);
            $table->index(['company_id', 'contact_id']);
            $table->foreign('currency')->references('code')->on('currencies');
        });
        DB::statement('ALTER TABLE journal_lines ADD CONSTRAINT journal_lines_amounts_check CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))');
        Rls::enable(DB::connection(), 'journal_lines');

        Schema::create('sequences', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('sequence_key', 64);
            $table->string('prefix', 32)->default('');
            $table->bigInteger('next_value')->default(1);
            $table->smallInteger('padding')->default(5);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'sequence_key']);
        });
        Rls::enable(DB::connection(), 'sequences');

        Schema::create('account_period_balances', function (Blueprint $table) {
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'account_id', 'accounts');
            Rls::companyRef($table, 'fiscal_period_id', 'fiscal_periods');
            for ($p = 1; $p <= 8; $p++) {
                $table->uuid("dim{$p}_value_id")->nullable();
            }
            $table->binary('dim_key');
            $table->bigInteger('debit')->default(0);
            $table->bigInteger('credit')->default(0);
            $table->primary(['tenant_id', 'company_id', 'account_id', 'fiscal_period_id', 'dim_key']);
            $table->index(['company_id', 'fiscal_period_id']);
        });
        Rls::enable(DB::connection(), 'account_period_balances');

        SqlFile::run(DB::connection(), 'ledger_triggers.sql');
    }

    public function down(): void
    {
        DB::unprepared('DROP FUNCTION IF EXISTS journal_lines_guard() CASCADE; DROP FUNCTION IF EXISTS posted_row_guard() CASCADE; DROP FUNCTION IF EXISTS journal_balanced() CASCADE; DROP FUNCTION IF EXISTS journal_period_open() CASCADE;');
        Schema::dropIfExists('account_period_balances');
        Schema::dropIfExists('sequences');
        Schema::dropIfExists('journal_lines');
        Schema::dropIfExists('journals');
    }
};
