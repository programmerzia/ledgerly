<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Settlements (receipts, payments, customer and supplier refunds), their allocations, the later application of
 * credit (credit on account, credit and debit notes), payment runs and WHT certificates (05 §9, 13 §9, D4, D9, D11).
 *
 * Differences from the 05 sketch, all recorded in 05_Schema: `refund` means a customer refund, so `supplier_refund` is
 * a fourth kind (D11); `cash_account_id` is the cash or bank GL account until `bank_accounts` exist (2.13, which fills
 * the nullable `bank_account_id`); `unallocated` keeps the base value of the credit (D9); `bank_charges_fc` and a
 * settlement-level `wht_amount_fc` are not created (no document defines them; WHT on a bill is withheld when the
 * bill posts, so a payment settles the net and never withholds twice); the payment run's `total` is split into gross,
 * WHT and net as the mock shows them.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'posted', 'reversed', 'void'])->default('draft');
            Rls::companyRef($table, 'cash_account_id', 'accounts');
            $table->uuid('bank_account_id')->nullable(); // FK arrives with bank_accounts (2.13)
            $table->date('run_date');
            $table->char('currency', 3);
            $table->decimal('fx_rate', 20, 8)->default(1);
            $table->bigInteger('total_gross')->default(0);
            $table->bigInteger('total_wht')->default(0);
            $table->bigInteger('total_net')->default(0);
            $table->bigInteger('total')->default(0); // net, in base: the workflow amount
            $table->string('reference')->nullable();
            $table->text('memo')->nullable();
            $table->string('export_file_path')->nullable();
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
            $table->foreign('currency')->references('code')->on('currencies');
        });
        foreach ([
            'payment_runs_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'payment_runs_posted_complete' => "status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND posted_at IS NOT NULL)",
            'payment_runs_amounts_check' => 'total_gross >= 0 AND total_wht >= 0 AND total_net >= 0 AND total >= 0 AND total_gross = total_net + total_wht',
            'payment_runs_rate_check' => 'fx_rate > 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE payment_runs ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'payment_runs');

        Schema::create('payment_run_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'payment_run_id', 'payment_runs');
            $table->smallInteger('line_no');
            Rls::companyRef($table, 'invoice_id', 'invoices');
            Rls::companyRef($table, 'contact_id', 'contacts');
            $table->bigInteger('amount_fc'); // paid to the supplier (net of the tax withheld at bill posting)
            $table->bigInteger('wht_amount_fc')->default(0); // the withheld share this payment covers (informational)
            $table->timestampsTz();
            $table->unique(['payment_run_id', 'invoice_id']);
            $table->unique(['payment_run_id', 'line_no']);
        });
        DB::statement('ALTER TABLE payment_run_items ADD CONSTRAINT payment_run_items_amount_check CHECK (amount_fc > 0 AND wht_amount_fc >= 0)');
        Rls::enable(DB::connection(), 'payment_run_items');

        Schema::create('settlements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->enum('kind', ['receipt', 'payment', 'refund', 'supplier_refund']);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'posted', 'reversed', 'void'])->default('draft');
            Rls::companyRef($table, 'contact_id', 'contacts');
            Rls::companyRef($table, 'cash_account_id', 'accounts');
            $table->uuid('bank_account_id')->nullable(); // FK arrives with bank_accounts (2.13)
            $table->date('settlement_date');
            $table->char('currency', 3);
            $table->decimal('fx_rate', 20, 8)->default(1);
            $table->bigInteger('amount_fc');
            $table->bigInteger('amount');
            // Credit on account (D9): what is not allocated stays on the control account until applied or refunded.
            $table->bigInteger('unallocated_fc')->default(0);
            $table->bigInteger('unallocated')->default(0);
            $table->string('reference')->nullable();
            $table->text('memo')->nullable();
            Rls::companyRef($table, 'payment_run_id', 'payment_runs', nullable: true);
            Rls::companyRef($table, 'journal_id', 'journals', nullable: true);
            Rls::companyRef($table, 'reversal_journal_id', 'journals', nullable: true);
            for ($p = 1; $p <= 8; $p++) {
                Rls::companyRef($table, "dim{$p}_value_id", 'dimension_values', nullable: true);
            }
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
            $table->index(['company_id', 'settlement_date']);
            $table->index(['payment_run_id']);
            $table->foreign('currency')->references('code')->on('currencies');
        });
        foreach ([
            'settlements_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'settlements_posted_complete' => "status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND journal_id IS NOT NULL AND posted_at IS NOT NULL)",
            'settlements_amount_check' => 'amount_fc > 0 AND amount > 0',
            'settlements_unallocated_check' => 'unallocated_fc >= 0 AND unallocated_fc <= amount_fc AND unallocated >= 0',
            'settlements_rate_check' => 'fx_rate > 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE settlements ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'settlements');

        Schema::create('settlement_allocations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'settlement_id', 'settlements');
            // The target: a document (invoice, bill, credit note, debit note) or, for a refund of credit on account, a settlement.
            Rls::companyRef($table, 'invoice_id', 'invoices', nullable: true);
            Rls::companyRef($table, 'source_settlement_id', 'settlements', nullable: true);
            $table->bigInteger('amount_fc');
            $table->bigInteger('amount')->default(0); // base carried for the target (D4); fixed when the settlement posts
            $table->bigInteger('fx_gain_loss')->default(0); // signed by cash direction: positive is a gain
            $table->timestampsTz();
            $table->index(['company_id', 'invoice_id']);
            $table->index(['company_id', 'source_settlement_id']);
        });
        DB::statement('CREATE UNIQUE INDEX settlement_allocations_invoice_unique ON settlement_allocations (settlement_id, invoice_id) WHERE invoice_id IS NOT NULL');
        DB::statement('CREATE UNIQUE INDEX settlement_allocations_source_unique ON settlement_allocations (settlement_id, source_settlement_id) WHERE source_settlement_id IS NOT NULL');
        foreach ([
            'settlement_allocations_target_check' => '(invoice_id IS NOT NULL) <> (source_settlement_id IS NOT NULL)',
            'settlement_allocations_amount_check' => 'amount_fc > 0 AND amount >= 0',
            'settlement_allocations_self_check' => 'source_settlement_id IS NULL OR source_settlement_id <> settlement_id',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE settlement_allocations ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'settlement_allocations');

        // Credit applied later (D9): credit on account of a settlement, or a posted credit or debit note, against an open document.
        Schema::create('credit_applications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'settlement_id', 'settlements', nullable: true);
            Rls::companyRef($table, 'note_id', 'invoices', nullable: true);
            Rls::companyRef($table, 'invoice_id', 'invoices');
            $table->bigInteger('amount_fc');
            $table->bigInteger('source_amount'); // base released from the credit (at its rate)
            $table->bigInteger('amount'); // base carried for the target (at its rate)
            $table->bigInteger('fx_gain_loss')->default(0); // positive is a gain
            $table->date('applied_on');
            Rls::companyRef($table, 'journal_id', 'journals');
            Rls::companyRef($table, 'reversal_journal_id', 'journals', nullable: true);
            $table->timestampTz('reversed_at')->nullable();
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->index(['company_id', 'invoice_id']);
            $table->index(['company_id', 'settlement_id']);
            $table->index(['company_id', 'note_id']);
        });
        foreach ([
            'credit_applications_source_check' => '(settlement_id IS NOT NULL) <> (note_id IS NOT NULL)',
            'credit_applications_amount_check' => 'amount_fc > 0 AND source_amount >= 0 AND amount >= 0',
            'credit_applications_reversed_check' => '(reversed_at IS NULL) = (reversal_journal_id IS NULL)',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE credit_applications ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'credit_applications');

        Schema::create('wht_certificates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32);
            Rls::companyRef($table, 'payment_id', 'settlements');
            Rls::companyRef($table, 'invoice_id', 'invoices');
            Rls::companyRef($table, 'contact_id', 'contacts');
            Rls::companyRef($table, 'tax_code_id', 'tax_codes');
            $table->bigInteger('base_amount'); // base currency
            $table->bigInteger('wht_amount');
            $table->date('issued_on');
            $table->enum('status', ['issued', 'void'])->default('issued'); // void when the payment is reversed; the number stays used
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'number']);
            $table->index(['company_id', 'contact_id']);
            $table->index(['company_id', 'issued_on']);
            $table->index(['company_id', 'invoice_id']);
        });
        DB::statement('ALTER TABLE wht_certificates ADD CONSTRAINT wht_certificates_amount_check CHECK (base_amount >= 0 AND wht_amount > 0)');
        Rls::enable(DB::connection(), 'wht_certificates');

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER settlements_posted_row_guard
              BEFORE UPDATE OR DELETE ON settlements
              FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'unallocated_fc', 'unallocated', 'reversal_journal_id', 'lock_version', 'updated_at');

            CREATE TRIGGER payment_runs_posted_row_guard
              BEFORE UPDATE OR DELETE ON payment_runs
              FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'export_file_path', 'lock_version', 'updated_at');

            -- Allocations and run items belong to the document: frozen with it once it is posted or reversed.
            CREATE OR REPLACE FUNCTION settlement_children_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            DECLARE
              parent_status text;
              parent_id uuid;
            BEGIN
              IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN
                RETURN OLD;
              END IF;
              IF TG_OP IN ('UPDATE', 'DELETE') THEN
                IF TG_TABLE_NAME = 'settlement_allocations' THEN
                  SELECT status INTO parent_status FROM settlements WHERE id = OLD.settlement_id;
                ELSE
                  SELECT status INTO parent_status FROM payment_runs WHERE id = OLD.payment_run_id;
                END IF;
                IF parent_status IN ('posted', 'reversed') THEN
                  RAISE EXCEPTION '%: parent is %', TG_TABLE_NAME, parent_status USING ERRCODE = 'LG001';
                END IF;
              END IF;
              IF TG_OP IN ('INSERT', 'UPDATE') THEN
                IF TG_TABLE_NAME = 'settlement_allocations' THEN
                  SELECT status INTO parent_status FROM settlements WHERE id = NEW.settlement_id;
                ELSE
                  SELECT status INTO parent_status FROM payment_runs WHERE id = NEW.payment_run_id;
                END IF;
                IF parent_status IN ('posted', 'reversed') THEN
                  RAISE EXCEPTION '%: parent is %', TG_TABLE_NAME, parent_status USING ERRCODE = 'LG001';
                END IF;
                RETURN NEW;
              END IF;
              RETURN OLD;
            END
            $$;

            CREATE TRIGGER settlement_allocations_guard BEFORE INSERT OR UPDATE OR DELETE ON settlement_allocations
              FOR EACH ROW EXECUTE FUNCTION settlement_children_guard();
            CREATE TRIGGER payment_run_items_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_run_items
              FOR EACH ROW EXECUTE FUNCTION settlement_children_guard();

            -- A credit application is never edited or deleted; undoing it stamps reversed_at once.
            CREATE OR REPLACE FUNCTION credit_applications_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                IF purge_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
                RAISE EXCEPTION 'credit_applications_guard: applications are never deleted' USING ERRCODE = 'LG002';
              END IF;
              IF OLD.reversed_at IS NOT NULL
                 OR (to_jsonb(NEW) - 'reversed_at' - 'reversal_journal_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'reversed_at' - 'reversal_journal_id' - 'updated_at') THEN
                RAISE EXCEPTION 'credit_applications_guard: only the first reversal may change an application' USING ERRCODE = 'LG002';
              END IF;
              RETURN NEW;
            END
            $$;

            CREATE TRIGGER credit_applications_guard BEFORE UPDATE OR DELETE ON credit_applications
              FOR EACH ROW EXECUTE FUNCTION credit_applications_guard();

            -- A certificate is never edited; it becomes void when its payment is reversed.
            CREATE OR REPLACE FUNCTION wht_certificates_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                IF purge_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
                RAISE EXCEPTION 'wht_certificates_guard: certificates are never deleted' USING ERRCODE = 'LG002';
              END IF;
              IF OLD.status = 'void' OR (to_jsonb(NEW) - 'status' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'updated_at') THEN
                RAISE EXCEPTION 'wht_certificates_guard: only issued → void is allowed' USING ERRCODE = 'LG002';
              END IF;
              RETURN NEW;
            END
            $$;

            CREATE TRIGGER wht_certificates_guard BEFORE UPDATE OR DELETE ON wht_certificates
              FOR EACH ROW EXECUTE FUNCTION wht_certificates_guard();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP FUNCTION IF EXISTS settlement_children_guard() CASCADE; DROP FUNCTION IF EXISTS credit_applications_guard() CASCADE; DROP FUNCTION IF EXISTS wht_certificates_guard() CASCADE');
        Schema::dropIfExists('wht_certificates');
        Schema::dropIfExists('credit_applications');
        Schema::dropIfExists('settlement_allocations');
        Schema::dropIfExists('settlements');
        Schema::dropIfExists('payment_run_items');
        Schema::dropIfExists('payment_runs');
    }
};
