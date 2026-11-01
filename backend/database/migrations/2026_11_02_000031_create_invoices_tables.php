<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Invoices, credit notes, bills and debit notes in one table (05 §9, 13 §9, plan 2.11), with their lines.
 *
 * `fc` columns are in the document currency, plain ones in base (D1). Credit and debit notes carry positive
 * amounts: their `kind` makes them reverse the parent's accounting. `settled_fc`/`settled` start at zero and
 * move only through the settlement Actions (2.12); the posted-row guard lets only them (and the status, the
 * reversal link and the version) change after posting. Lines of a posted document are immutable.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('invoices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->enum('kind', ['sales_invoice', 'credit_note', 'purchase_bill', 'debit_note']);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'posted', 'reversed', 'void'])->default('draft');
            Rls::companyRef($table, 'contact_id', 'contacts');
            $table->date('issue_date');
            $table->date('due_date');
            $table->char('currency', 3);
            $table->decimal('fx_rate', 20, 8)->default(1);
            $table->string('reference')->nullable();
            $table->text('memo')->nullable();
            $table->bigInteger('subtotal_fc')->default(0);
            $table->bigInteger('tax_total_fc')->default(0);
            $table->bigInteger('total_fc')->default(0);
            $table->bigInteger('subtotal')->default(0);
            $table->bigInteger('tax_total')->default(0);
            $table->bigInteger('total')->default(0);
            // Withholding tax (bills and debit notes): held back from the supplier, so it lowers the amount due.
            Rls::companyRef($table, 'wht_code_id', 'tax_codes', nullable: true);
            $table->bigInteger('wht_amount_fc')->default(0);
            $table->bigInteger('wht_amount')->default(0);
            $table->bigInteger('settled_fc')->default(0);
            $table->bigInteger('settled')->default(0);
            $table->uuid('related_invoice_id')->nullable();
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
            $table->unique(['tenant_id', 'company_id', 'kind', 'number']);
            $table->index(['company_id', 'kind', 'status']);
            $table->index(['company_id', 'contact_id', 'status']);
            $table->index(['company_id', 'issue_date']);
            $table->foreign('currency')->references('code')->on('currencies');
        });
        Schema::table('invoices', function (Blueprint $table) {
            $table->foreign(['tenant_id', 'company_id', 'related_invoice_id'])->references(['tenant_id', 'company_id', 'id'])->on('invoices')->restrictOnDelete();
        });
        DB::statement("CREATE INDEX invoices_due_open ON invoices (company_id, due_date) WHERE status = 'posted'");
        foreach ([
            'invoices_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'invoices_posted_complete' => "status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND journal_id IS NOT NULL AND posted_at IS NOT NULL)",
            'invoices_amounts_check' => 'subtotal_fc >= 0 AND tax_total_fc >= 0 AND total_fc = subtotal_fc + tax_total_fc AND subtotal >= 0 AND tax_total >= 0 AND total >= 0',
            'invoices_rate_check' => 'fx_rate > 0',
            'invoices_due_date_check' => 'due_date >= issue_date',
            'invoices_wht_check' => 'wht_amount_fc >= 0 AND wht_amount_fc <= total_fc AND wht_amount >= 0 AND wht_amount <= total',
            'invoices_wht_kind_check' => "kind IN ('purchase_bill', 'debit_note') OR (wht_code_id IS NULL AND wht_amount_fc = 0 AND wht_amount = 0)",
            'invoices_related_kind_check' => "related_invoice_id IS NULL OR kind IN ('credit_note', 'debit_note')",
            // Settlement may never exceed the document (D4: the allocation that settles it fully takes the remaining base).
            'invoices_settled_check' => 'settled_fc >= 0 AND settled_fc <= total_fc AND settled >= 0 AND settled <= total',
            'invoices_settled_state_check' => "status IN ('posted', 'reversed') OR (settled_fc = 0 AND settled = 0)",
        ] as $name => $expression) {
            DB::statement("ALTER TABLE invoices ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'invoices');

        Schema::create('invoice_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'invoice_id', 'invoices');
            $table->smallInteger('line_no');
            Rls::companyRef($table, 'item_id', 'items', nullable: true);
            Rls::companyRef($table, 'account_id', 'accounts');
            $table->text('description')->nullable();
            $table->decimal('quantity', 18, 6);
            $table->bigInteger('unit_price_fc');
            $table->decimal('discount_pct', 7, 4)->default(0);
            Rls::companyRef($table, 'tax_code_id', 'tax_codes', nullable: true);
            $table->bigInteger('line_total_fc');
            $table->bigInteger('tax_amount_fc')->default(0);
            // This line's share of the tax per tax code (D2): {"<tax code id>": minor units}.
            $table->jsonb('tax_detail')->default('{}');
            for ($p = 1; $p <= 8; $p++) {
                Rls::companyRef($table, "dim{$p}_value_id", 'dimension_values', nullable: true);
            }
            $table->timestampsTz();
            $table->unique(['invoice_id', 'line_no']);
            $table->index(['company_id', 'account_id']);
        });
        foreach ([
            'invoice_lines_amounts_check' => 'quantity > 0 AND unit_price_fc >= 0 AND discount_pct >= 0 AND discount_pct <= 100 AND line_total_fc >= 0 AND tax_amount_fc >= 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE invoice_lines ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'invoice_lines');

        // Posted documents: only whitelisted columns change (13 §9). The function is defined by the ledger migration.
        DB::unprepared(<<<'SQL'
            CREATE TRIGGER invoices_posted_row_guard
              BEFORE UPDATE OR DELETE ON invoices
              FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'settled_fc', 'settled', 'reversal_journal_id', 'lock_version', 'updated_at');

            CREATE OR REPLACE FUNCTION invoice_lines_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            DECLARE
              parent_status text;
            BEGIN
              IF TG_OP IN ('UPDATE', 'DELETE') THEN
                IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN
                  RETURN OLD;
                END IF;
                SELECT status INTO parent_status FROM invoices WHERE id = OLD.invoice_id;
                IF parent_status IN ('posted', 'reversed') THEN
                  RAISE EXCEPTION 'invoice_lines_guard: invoice % is %', OLD.invoice_id, parent_status USING ERRCODE = 'LG001';
                END IF;
              END IF;
              IF TG_OP IN ('INSERT', 'UPDATE') THEN
                SELECT status INTO parent_status FROM invoices WHERE id = NEW.invoice_id;
                IF parent_status IN ('posted', 'reversed') THEN
                  RAISE EXCEPTION 'invoice_lines_guard: invoice % is %', NEW.invoice_id, parent_status USING ERRCODE = 'LG001';
                END IF;
                RETURN NEW;
              END IF;
              RETURN OLD;
            END
            $$;

            CREATE TRIGGER invoice_lines_guard
              BEFORE INSERT OR UPDATE OR DELETE ON invoice_lines
              FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP FUNCTION IF EXISTS invoice_lines_guard() CASCADE');
        Schema::dropIfExists('invoice_lines');
        Schema::dropIfExists('invoices');
    }
};
