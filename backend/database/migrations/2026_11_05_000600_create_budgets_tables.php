<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Budgets (13 §23 D15 item 5, plan 3c.16). A budget belongs to a fiscal year and has a version; lines are account x regular period x the
 * eight dimension slots, in base-currency minor units, in the account's natural direction (income as a positive figure, expense as a
 * positive figure), the same direction the profit and loss report uses. Budgets never touch the ledger.
 *
 * Only one approved version per fiscal year (partial unique index). An approved or archived budget is read-only, in the database as well
 * as in the Action: its lines cannot be inserted, changed or deleted, and its header can only move approved → archived. The approver is
 * never the maker (CHECK).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('budgets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'fiscal_year_id', 'fiscal_years');
            $table->string('name', 120);
            $table->integer('version');
            $table->enum('status', ['draft', 'approved', 'archived'])->default('draft');
            $table->uuid('copied_from_id')->nullable();
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampTz('archived_at')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'fiscal_year_id', 'version']);
            $table->index(['company_id', 'fiscal_year_id', 'status']);
            $table->foreign(['tenant_id', 'company_id', 'copied_from_id'])->references(['tenant_id', 'company_id', 'id'])->on('budgets');
        });
        DB::statement("CREATE UNIQUE INDEX budgets_one_approved_per_year ON budgets (tenant_id, company_id, fiscal_year_id) WHERE status = 'approved'");
        DB::statement('ALTER TABLE budgets ADD CONSTRAINT budgets_maker_checker CHECK (approved_by IS NULL OR approved_by IS DISTINCT FROM created_by)');
        DB::statement("ALTER TABLE budgets ADD CONSTRAINT budgets_approved_has_approver CHECK (status = 'draft' OR approved_at IS NOT NULL)");
        Rls::enable(DB::connection(), 'budgets');

        Schema::create('budget_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'budget_id', 'budgets');
            Rls::companyRef($table, 'account_id', 'accounts');
            Rls::companyRef($table, 'fiscal_period_id', 'fiscal_periods');
            for ($p = 1; $p <= 8; $p++) {
                Rls::companyRef($table, "dim{$p}_value_id", 'dimension_values', nullable: true);
            }
            $table->binary('dim_key');
            $table->bigInteger('amount');
            $table->timestampsTz();
            $table->unique(['budget_id', 'account_id', 'fiscal_period_id', 'dim_key']);
            $table->index(['company_id', 'budget_id']);
        });
        DB::statement('ALTER TABLE budget_lines ADD CONSTRAINT budget_lines_amount_range CHECK (amount BETWEEN -999999999999999 AND 999999999999999)');
        Rls::enable(DB::connection(), 'budget_lines');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION budget_lines_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            DECLARE
              parent_status text;
            BEGIN
              IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
              IF TG_OP IN ('UPDATE', 'DELETE') THEN
                SELECT status INTO parent_status FROM budgets WHERE id = OLD.budget_id;
                IF parent_status IS NOT NULL AND parent_status <> 'draft' THEN
                  RAISE EXCEPTION 'budget_lines_guard: budget % is %', OLD.budget_id, parent_status USING ERRCODE = 'LG020';
                END IF;
              END IF;
              IF TG_OP IN ('INSERT', 'UPDATE') THEN
                SELECT status INTO parent_status FROM budgets WHERE id = NEW.budget_id;
                IF parent_status <> 'draft' THEN
                  RAISE EXCEPTION 'budget_lines_guard: budget % is %', NEW.budget_id, parent_status USING ERRCODE = 'LG020';
                END IF;
                RETURN NEW;
              END IF;
              RETURN OLD;
            END
            $$;
            CREATE TRIGGER budget_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON budget_lines
              FOR EACH ROW EXECUTE FUNCTION budget_lines_guard();

            CREATE OR REPLACE FUNCTION budgets_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                IF purge_allowed(OLD.tenant_id) OR OLD.status = 'draft' THEN RETURN OLD; END IF;
                RAISE EXCEPTION 'budgets_guard: budget % is % and cannot be deleted', OLD.id, OLD.status USING ERRCODE = 'LG020';
              END IF;
              IF OLD.status = 'draft' THEN RETURN NEW; END IF;
              IF OLD.status = 'approved' AND NEW.status = 'archived'
                 AND (to_jsonb(NEW) - 'status' - 'archived_at' - 'lock_version' - 'updated_at') = (to_jsonb(OLD) - 'status' - 'archived_at' - 'lock_version' - 'updated_at') THEN
                RETURN NEW;
              END IF;
              RAISE EXCEPTION 'budgets_guard: budget % is % and is read-only', OLD.id, OLD.status USING ERRCODE = 'LG020';
            END
            $$;
            CREATE TRIGGER budgets_guard BEFORE UPDATE OR DELETE ON budgets
              FOR EACH ROW EXECUTE FUNCTION budgets_guard();
        SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('budget_lines');
        Schema::dropIfExists('budgets');
        DB::unprepared('DROP FUNCTION IF EXISTS budget_lines_guard(); DROP FUNCTION IF EXISTS budgets_guard();');
    }
};
