<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Depreciation runs (13 §8, §23 D15.1, plan 3c.14): one document per company and period that posts one journal for every
 * asset's charge. Like the other posted documents it has a number only when posted, maker ≠ checker in the database, only a
 * whitelist of columns changes after posting, and its lines freeze with it.
 *
 * One run per company and period unless the earlier one is voided or reversed: the partial unique index is the guarantee,
 * the Action's check only gives a clear message.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('depreciation_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32)->nullable();
            $table->string('status', 24)->default('draft');
            Rls::companyRef($table, 'fiscal_period_id', 'fiscal_periods');
            $table->date('as_of');
            $table->bigInteger('total')->default(0);
            Rls::companyRef($table, 'journal_id', 'journals', nullable: true);
            Rls::companyRef($table, 'reversal_journal_id', 'journals', nullable: true);
            $table->text('memo')->nullable();
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->uuid('posted_by')->nullable();
            $table->timestampTz('posted_at')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'number']);
            $table->index(['company_id', 'status']);
        });
        foreach ([
            'depreciation_runs_status_check' => "status IN ('draft', 'pending_approval', 'posted', 'reversed', 'void')",
            'depreciation_runs_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'depreciation_runs_posted_complete' => "status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND posted_at IS NOT NULL)",
            'depreciation_runs_total_check' => 'total >= 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE depreciation_runs ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        DB::statement("CREATE UNIQUE INDEX depreciation_runs_one_per_period ON depreciation_runs (company_id, fiscal_period_id) WHERE status NOT IN ('void', 'reversed')");
        Rls::enable(DB::connection(), 'depreciation_runs');

        Schema::create('depreciation_run_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'depreciation_run_id', 'depreciation_runs');
            $table->smallInteger('line_no');
            Rls::companyRef($table, 'asset_id', 'fixed_assets');
            $table->bigInteger('amount');
            $table->integer('months');
            $table->bigInteger('units')->default(0);
            $table->jsonb('detail')->default('{}');
            $table->timestampsTz();
            $table->unique(['depreciation_run_id', 'line_no']);
            $table->unique(['depreciation_run_id', 'asset_id']);
        });
        DB::statement('ALTER TABLE depreciation_run_lines ADD CONSTRAINT depreciation_run_lines_check CHECK (amount >= 0 AND months >= 1 AND units >= 0)');
        Rls::enable(DB::connection(), 'depreciation_run_lines');

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER depreciation_runs_posted_row_guard
              BEFORE UPDATE OR DELETE ON depreciation_runs
              FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'reversal_journal_id', 'lock_version', 'updated_at');

            -- Lines of the document freeze with it once posted or reversed (LG001).
            CREATE OR REPLACE FUNCTION depreciation_run_lines_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            DECLARE
              parent_status text;
            BEGIN
              IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN
                RETURN OLD;
              END IF;
              IF TG_OP IN ('UPDATE', 'DELETE') THEN
                SELECT status INTO parent_status FROM depreciation_runs WHERE id = OLD.depreciation_run_id;
                IF parent_status IN ('posted', 'reversed') THEN
                  RAISE EXCEPTION 'depreciation_run_lines_guard: run is %', parent_status USING ERRCODE = 'LG001';
                END IF;
              END IF;
              IF TG_OP IN ('INSERT', 'UPDATE') THEN
                SELECT status INTO parent_status FROM depreciation_runs WHERE id = NEW.depreciation_run_id;
                IF parent_status IN ('posted', 'reversed') THEN
                  RAISE EXCEPTION 'depreciation_run_lines_guard: run is %', parent_status USING ERRCODE = 'LG001';
                END IF;
                RETURN NEW;
              END IF;
              RETURN OLD;
            END
            $$;

            CREATE TRIGGER depreciation_run_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON depreciation_run_lines
              FOR EACH ROW EXECUTE FUNCTION depreciation_run_lines_guard();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP FUNCTION IF EXISTS depreciation_run_lines_guard() CASCADE');
        Schema::dropIfExists('depreciation_run_lines');
        Schema::dropIfExists('depreciation_runs');
    }
};
