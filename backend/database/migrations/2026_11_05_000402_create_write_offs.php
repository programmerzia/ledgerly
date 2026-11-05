<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Customer write-offs (13 §23 D15 item 2, plan 3c.9): an approved document against one posted invoice, for up to its open
 * amount, with a reason. `amount_fc` is in the invoice's currency; `amount` is the base carried (the invoice's carrying
 * amount, D4: nothing is received, so no FX arises); `allowance_used` is the part charged to the credit-loss allowance and
 * `expense` the rest to bad-debt expense (`amount = allowance_used + expense`). VAT is not adjusted (D15.2).
 *
 * Posting raises the invoice's `settled_fc`/`settled` (whitelisted on invoices), so its open amount, payment status and aging
 * follow without a new column there. `recovered_fc` is reserved for recoveries after write-off (not built yet).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('write_offs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'posted', 'reversed', 'void'])->default('draft');
            Rls::companyRef($table, 'invoice_id', 'invoices');
            Rls::companyRef($table, 'contact_id', 'contacts');
            $table->date('write_off_date');
            $table->char('currency', 3);
            $table->decimal('fx_rate', 20, 8)->default(1);
            $table->bigInteger('amount_fc');
            $table->bigInteger('amount');
            $table->bigInteger('allowance_used')->default(0);
            $table->bigInteger('expense')->default(0);
            $table->bigInteger('recovered_fc')->default(0);
            $table->text('reason');
            $table->string('reference')->nullable();
            $table->text('memo')->nullable();
            $table->uuid('journal_id')->nullable();
            $table->uuid('reversal_journal_id')->nullable();
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
            $table->index(['company_id', 'invoice_id']);
            $table->foreign('currency')->references('code')->on('currencies');
        });
        foreach ([
            'write_offs_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'write_offs_posted_complete' => "status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND posted_at IS NOT NULL AND journal_id IS NOT NULL)",
            'write_offs_amounts_check' => 'amount_fc > 0 AND amount > 0 AND allowance_used >= 0 AND expense >= 0 AND allowance_used + expense = amount AND recovered_fc >= 0 AND recovered_fc <= amount_fc AND fx_rate > 0',
            'write_offs_reason_check' => 'length(btrim(reason)) > 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE write_offs ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'write_offs');

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER write_offs_posted_row_guard
              BEFORE UPDATE OR DELETE ON write_offs
              FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'recovered_fc', 'reversal_journal_id', 'lock_version', 'updated_at');
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('write_offs');
    }
};
