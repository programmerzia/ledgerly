<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Asset transactions (13 §23 D15.1, plans 3c.15 and 3c.15a): disposal, impairment, impairment reversal and the revaluation of a
 * whole category. One document type with a line per asset; each posts one journal (type `asset`) after approval and signing.
 * Disposal and impairment have one line, a revaluation has a line for every asset of the category (IAS 16.36).
 *
 * `figures` on a line is what the preview showed and the approvers signed; posting works it out again from the locked asset and
 * refuses if it differs. Like other posted documents: numbered only when posted, maker ≠ checker in the database, whitelisted
 * columns after posting, lines frozen with the document.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('ALTER TABLE journals DROP CONSTRAINT journals_journal_type_check');
        DB::statement("ALTER TABLE journals ADD CONSTRAINT journals_journal_type_check CHECK (journal_type IN ('manual', 'sales', 'purchase', 'receipt', 'payment', 'bank', 'fx', 'depreciation', 'closing', 'adjustment', 'reversal', 'opening', 'asset'))");

        Schema::create('asset_transactions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32)->nullable();
            $table->string('kind', 24);
            $table->string('status', 24)->default('draft');
            $table->date('tx_date');
            Rls::companyRef($table, 'category_id', 'asset_categories', nullable: true);
            $table->bigInteger('amount')->default(0);
            $table->text('reason')->nullable();
            $table->jsonb('params')->default('{}');
            Rls::companyRef($table, 'journal_id', 'journals', nullable: true);
            Rls::companyRef($table, 'reversal_journal_id', 'journals', nullable: true);
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
            $table->index(['company_id', 'kind', 'tx_date']);
        });
        foreach ([
            'asset_transactions_kind_check' => "kind IN ('disposal', 'impairment', 'impairment_reversal', 'revaluation')",
            'asset_transactions_status_check' => "status IN ('draft', 'pending_approval', 'posted', 'reversed', 'void')",
            'asset_transactions_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'asset_transactions_posted_complete' => "status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND posted_at IS NOT NULL)",
            'asset_transactions_amount_check' => 'amount >= 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE asset_transactions ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'asset_transactions');

        Schema::create('asset_transaction_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'asset_transaction_id', 'asset_transactions');
            $table->smallInteger('line_no');
            Rls::companyRef($table, 'asset_id', 'fixed_assets');
            $table->bigInteger('input_amount');
            $table->jsonb('figures')->default('{}');
            $table->timestampsTz();
            $table->unique(['asset_transaction_id', 'line_no']);
            $table->unique(['asset_transaction_id', 'asset_id']);
        });
        Rls::enable(DB::connection(), 'asset_transaction_lines');

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER asset_transactions_posted_row_guard
              BEFORE UPDATE OR DELETE ON asset_transactions
              FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'reversal_journal_id', 'lock_version', 'updated_at');

            CREATE OR REPLACE FUNCTION asset_transaction_lines_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            DECLARE
              parent_status text;
            BEGIN
              IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN
                RETURN OLD;
              END IF;
              IF TG_OP IN ('UPDATE', 'DELETE') THEN
                SELECT status INTO parent_status FROM asset_transactions WHERE id = OLD.asset_transaction_id;
                IF parent_status IN ('posted', 'reversed') THEN
                  RAISE EXCEPTION 'asset_transaction_lines_guard: document is %', parent_status USING ERRCODE = 'LG001';
                END IF;
              END IF;
              IF TG_OP IN ('INSERT', 'UPDATE') THEN
                SELECT status INTO parent_status FROM asset_transactions WHERE id = NEW.asset_transaction_id;
                IF parent_status IN ('posted', 'reversed') THEN
                  RAISE EXCEPTION 'asset_transaction_lines_guard: document is %', parent_status USING ERRCODE = 'LG001';
                END IF;
                RETURN NEW;
              END IF;
              RETURN OLD;
            END
            $$;

            CREATE TRIGGER asset_transaction_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON asset_transaction_lines
              FOR EACH ROW EXECUTE FUNCTION asset_transaction_lines_guard();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP FUNCTION IF EXISTS asset_transaction_lines_guard() CASCADE');
        Schema::dropIfExists('asset_transaction_lines');
        Schema::dropIfExists('asset_transactions');
        DB::statement('ALTER TABLE journals DROP CONSTRAINT journals_journal_type_check');
        DB::statement("ALTER TABLE journals ADD CONSTRAINT journals_journal_type_check CHECK (journal_type IN ('manual', 'sales', 'purchase', 'receipt', 'payment', 'bank', 'fx', 'depreciation', 'closing', 'adjustment', 'reversal', 'opening'))");
    }
};
