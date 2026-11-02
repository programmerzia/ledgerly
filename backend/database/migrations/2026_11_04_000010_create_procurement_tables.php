<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Procurement (05 §18, 13 §23 D14): requisitions, orders, order revisions, goods receipts, match results, and the
 * link from a bill line to the order line it bills. None of these tables is read by the posting code.
 *
 * Received and billed quantities are not stored: they are summed from receipts and bills under the order's lock.
 * Quantities are numeric(18,6), `fc` columns are in the document currency and plain ones in base, as on invoices.
 * A receipt is immutable once recorded: the only change is recorded → reversed, enforced here as well as in the Action.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('company_settings', function (Blueprint $table) {
            $table->boolean('require_purchase_order')->default(false);
            $table->decimal('po_price_tolerance_pct', 7, 4)->default(0);
            $table->decimal('po_quantity_tolerance_pct', 7, 4)->default(0);
            $table->decimal('receipt_over_tolerance_pct', 7, 4)->default(0);
        });
        DB::statement('ALTER TABLE company_settings ADD CONSTRAINT company_settings_tolerances_check CHECK (po_price_tolerance_pct BETWEEN 0 AND 100 AND po_quantity_tolerance_pct BETWEEN 0 AND 100 AND receipt_over_tolerance_pct BETWEEN 0 AND 100)');

        Schema::create('purchase_requisitions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'approved', 'rejected', 'void'])->default('draft');
            $table->date('requisition_date');
            $table->char('currency', 3);
            $table->text('memo')->nullable();
            $table->bigInteger('total')->default(0);
            $table->text('rejection_reason')->nullable();
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'number']);
            $table->index(['company_id', 'status']);
            $table->index(['company_id', 'requisition_date']);
            $table->foreign('currency')->references('code')->on('currencies');
        });
        foreach ([
            'purchase_requisitions_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'purchase_requisitions_approved_numbered' => "status <> 'approved' OR number IS NOT NULL",
            'purchase_requisitions_total_check' => 'total >= 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE purchase_requisitions ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'purchase_requisitions');

        Schema::create('purchase_requisition_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'purchase_requisition_id', 'purchase_requisitions');
            $table->smallInteger('line_no');
            Rls::companyRef($table, 'item_id', 'items', nullable: true);
            $table->text('description')->nullable();
            $table->decimal('quantity', 18, 6);
            $table->bigInteger('estimated_unit_price');
            $table->bigInteger('line_total');
            Rls::companyRef($table, 'account_id', 'accounts', nullable: true);
            for ($p = 1; $p <= 8; $p++) {
                Rls::companyRef($table, "dim{$p}_value_id", 'dimension_values', nullable: true);
            }
            $table->date('needed_by')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['purchase_requisition_id', 'line_no']);
        });
        DB::statement("ALTER TABLE purchase_requisition_lines ADD CONSTRAINT purchase_requisition_lines_check CHECK (quantity > 0 AND estimated_unit_price >= 0 AND line_total >= 0 AND (item_id IS NOT NULL OR COALESCE(description, '') <> ''))");
        Rls::enable(DB::connection(), 'purchase_requisition_lines');

        Schema::create('purchase_orders', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'approved', 'partly_received', 'received', 'closed', 'cancelled'])->default('draft');
            Rls::companyRef($table, 'contact_id', 'contacts');
            $table->date('order_date');
            $table->date('expected_date')->nullable();
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
            $table->integer('revision')->default(0);
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('approved_at')->nullable();
            $table->uuid('cancelled_by')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->text('cancel_reason')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->timestampTz('closed_at')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'number']);
            $table->index(['company_id', 'status']);
            $table->index(['company_id', 'contact_id', 'status']);
            $table->index(['company_id', 'order_date']);
            $table->foreign('currency')->references('code')->on('currencies');
        });
        foreach ([
            'purchase_orders_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'purchase_orders_approved_numbered' => "status IN ('draft', 'pending_approval', 'cancelled') OR number IS NOT NULL",
            'purchase_orders_amounts_check' => 'subtotal_fc >= 0 AND tax_total_fc >= 0 AND total_fc = subtotal_fc + tax_total_fc AND subtotal >= 0 AND tax_total >= 0 AND total >= 0',
            'purchase_orders_rate_check' => 'fx_rate > 0',
            'purchase_orders_revision_check' => 'revision >= 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE purchase_orders ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'purchase_orders');

        Schema::create('purchase_order_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'purchase_order_id', 'purchase_orders');
            $table->smallInteger('line_no');
            Rls::companyRef($table, 'requisition_line_id', 'purchase_requisition_lines', nullable: true);
            Rls::companyRef($table, 'item_id', 'items', nullable: true);
            Rls::companyRef($table, 'account_id', 'accounts');
            $table->text('description')->nullable();
            $table->decimal('quantity', 18, 6);
            $table->bigInteger('unit_price_fc');
            Rls::companyRef($table, 'tax_code_id', 'tax_codes', nullable: true);
            $table->bigInteger('line_total_fc');
            $table->bigInteger('tax_amount_fc')->default(0);
            $table->jsonb('tax_detail')->default('{}');
            for ($p = 1; $p <= 8; $p++) {
                Rls::companyRef($table, "dim{$p}_value_id", 'dimension_values', nullable: true);
            }
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['purchase_order_id', 'line_no']);
            $table->index(['company_id', 'account_id']);
            $table->index(['requisition_line_id']);
        });
        DB::statement('ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_order_lines_check CHECK (quantity > 0 AND unit_price_fc >= 0 AND line_total_fc >= 0 AND tax_amount_fc >= 0)');
        Rls::enable(DB::connection(), 'purchase_order_lines');

        Schema::create('purchase_order_revisions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'purchase_order_id', 'purchase_orders');
            $table->integer('revision_no')->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'applied', 'void'])->default('draft');
            $table->text('reason');
            $table->jsonb('proposed');
            $table->bigInteger('total')->default(0);
            $table->jsonb('before')->nullable();
            $table->jsonb('after')->nullable();
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->timestampTz('applied_at')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['purchase_order_id', 'revision_no']);
            $table->index(['company_id', 'status']);
        });
        DB::statement("CREATE UNIQUE INDEX purchase_order_revisions_one_open ON purchase_order_revisions (purchase_order_id) WHERE status IN ('draft', 'pending_approval')");
        foreach ([
            'purchase_order_revisions_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'purchase_order_revisions_applied_complete' => "status <> 'applied' OR (revision_no IS NOT NULL AND applied_at IS NOT NULL AND before IS NOT NULL AND after IS NOT NULL)",
            'purchase_order_revisions_reason_check' => "reason <> ''",
        ] as $name => $expression) {
            DB::statement("ALTER TABLE purchase_order_revisions ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'purchase_order_revisions');

        Schema::create('goods_receipts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'purchase_order_id', 'purchase_orders');
            $table->string('number', 32);
            $table->enum('status', ['recorded', 'reversed'])->default('recorded');
            $table->date('receipt_date');
            $table->string('reference')->nullable();
            $table->text('memo')->nullable();
            $table->text('reversal_reason')->nullable();
            $table->uuid('reversed_by')->nullable();
            $table->timestampTz('reversed_at')->nullable();
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'number']);
            $table->index(['company_id', 'purchase_order_id']);
            $table->index(['company_id', 'receipt_date']);
        });
        DB::statement("ALTER TABLE goods_receipts ADD CONSTRAINT goods_receipts_reversal_check CHECK (status = 'recorded' OR (reversal_reason IS NOT NULL AND reversed_at IS NOT NULL))");
        Rls::enable(DB::connection(), 'goods_receipts');

        Schema::create('goods_receipt_lines', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'goods_receipt_id', 'goods_receipts');
            Rls::companyRef($table, 'purchase_order_line_id', 'purchase_order_lines');
            $table->smallInteger('line_no');
            $table->decimal('quantity', 18, 6);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['goods_receipt_id', 'line_no']);
            $table->index(['purchase_order_line_id']);
        });
        DB::statement('ALTER TABLE goods_receipt_lines ADD CONSTRAINT goods_receipt_lines_quantity_check CHECK (quantity > 0)');
        Rls::enable(DB::connection(), 'goods_receipt_lines');

        Schema::table('invoice_lines', function (Blueprint $table) {
            Rls::companyRef($table, 'purchase_order_line_id', 'purchase_order_lines', nullable: true);
            Rls::companyRef($table, 'goods_receipt_line_id', 'goods_receipt_lines', nullable: true);
            $table->index(['purchase_order_line_id']);
        });

        Schema::create('bill_match_results', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'invoice_id', 'invoices');
            $table->enum('outcome', ['matched', 'overridden']);
            $table->jsonb('violations')->default('[]');
            $table->text('reason')->nullable();
            $table->uuid('decided_by')->nullable();
            $table->timestampTz('created_at');
            $table->index(['invoice_id']);
        });
        DB::statement("ALTER TABLE bill_match_results ADD CONSTRAINT bill_match_results_reason_check CHECK (outcome = 'matched' OR COALESCE(reason, '') <> '')");
        Rls::enable(DB::connection(), 'bill_match_results');

        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION goods_receipts_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' THEN
                IF purge_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
                RAISE EXCEPTION 'goods_receipts_guard: a goods receipt cannot be deleted' USING ERRCODE = 'LG002';
              END IF;
              IF OLD.status = 'reversed'
                 OR (NEW.id, NEW.tenant_id, NEW.company_id, NEW.purchase_order_id, NEW.number, NEW.receipt_date, NEW.reference, NEW.memo, NEW.created_by)
                    IS DISTINCT FROM
                    (OLD.id, OLD.tenant_id, OLD.company_id, OLD.purchase_order_id, OLD.number, OLD.receipt_date, OLD.reference, OLD.memo, OLD.created_by) THEN
                RAISE EXCEPTION 'goods_receipts_guard: a goods receipt can only be reversed' USING ERRCODE = 'LG002';
              END IF;
              RETURN NEW;
            END
            $$;
            CREATE TRIGGER goods_receipts_guard BEFORE UPDATE OR DELETE ON goods_receipts
              FOR EACH ROW EXECUTE FUNCTION goods_receipts_guard();

            CREATE OR REPLACE FUNCTION procurement_append_only_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
              RAISE EXCEPTION '%: rows are append-only', TG_TABLE_NAME USING ERRCODE = 'LG002';
            END
            $$;
            CREATE TRIGGER goods_receipt_lines_guard BEFORE UPDATE OR DELETE ON goods_receipt_lines
              FOR EACH ROW EXECUTE FUNCTION procurement_append_only_guard();
            CREATE TRIGGER bill_match_results_guard BEFORE UPDATE OR DELETE ON bill_match_results
              FOR EACH ROW EXECUTE FUNCTION procurement_append_only_guard();
        SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('bill_match_results');
        Schema::table('invoice_lines', function (Blueprint $table) {
            $table->dropColumn(['purchase_order_line_id', 'goods_receipt_line_id']);
        });
        Schema::dropIfExists('goods_receipt_lines');
        Schema::dropIfExists('goods_receipts');
        Schema::dropIfExists('purchase_order_revisions');
        Schema::dropIfExists('purchase_order_lines');
        Schema::dropIfExists('purchase_orders');
        Schema::dropIfExists('purchase_requisition_lines');
        Schema::dropIfExists('purchase_requisitions');
        DB::unprepared('DROP FUNCTION IF EXISTS goods_receipts_guard() CASCADE; DROP FUNCTION IF EXISTS procurement_append_only_guard() CASCADE;');
        Schema::table('company_settings', function (Blueprint $table) {
            $table->dropColumn(['require_purchase_order', 'po_price_tolerance_pct', 'po_quantity_tolerance_pct', 'receipt_over_tolerance_pct']);
        });
    }
};
