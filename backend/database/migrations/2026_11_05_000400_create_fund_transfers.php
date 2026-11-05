<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fund transfers (13 §23 D15 item 3, plan 3c.8): a document moving money between two of the company's own bank or cash
 * accounts in two legs through the `bank_in_transit` posting account. Amounts: `from_*` are in the source account's currency,
 * `to_*` in the destination's, `*_base` in the company's base currency; each leg has its own rate (IAS 21). `fx_difference`
 * is the base amount left in transit when the receive leg posts, signed (positive is a gain), and is cleared to realised FX.
 *
 * Once posted only the receive leg's fields, `leg_state`, the reversal links, `lock_version` and `updated_at` may change
 * (posted_row_guard); the two journals themselves are immutable. A transfer in `in_transit` has posted only its send leg.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fund_transfers', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'posted', 'reversed', 'void'])->default('draft');
            $table->enum('leg_state', ['not_sent', 'in_transit', 'completed'])->default('not_sent');
            Rls::companyRef($table, 'from_bank_account_id', 'bank_accounts');
            Rls::companyRef($table, 'to_bank_account_id', 'bank_accounts');
            $table->date('send_date');
            $table->char('from_currency', 3);
            $table->bigInteger('from_amount_fc');
            $table->decimal('send_rate', 20, 8)->default(1);
            $table->bigInteger('send_base');
            $table->bigInteger('fee_fc')->default(0);
            Rls::companyRef($table, 'fee_account_id', 'accounts', nullable: true);
            $table->char('to_currency', 3);
            $table->bigInteger('to_amount_fc');
            $table->decimal('receive_rate', 20, 8)->default(1);
            $table->bigInteger('receive_base')->nullable();
            $table->date('received_on')->nullable();
            $table->bigInteger('fx_difference')->nullable();
            $table->boolean('settle_same_day')->default(false);
            $table->string('reference')->nullable();
            $table->text('memo')->nullable();
            $table->uuid('send_journal_id')->nullable();
            $table->uuid('receive_journal_id')->nullable();
            $table->uuid('send_reversal_journal_id')->nullable();
            $table->uuid('receive_reversal_journal_id')->nullable();
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->uuid('submitted_by')->nullable();
            $table->uuid('approved_by')->nullable();
            $table->uuid('posted_by')->nullable();
            $table->timestampTz('posted_at')->nullable();
            $table->uuid('received_by')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'number']);
            $table->index(['company_id', 'status']);
            $table->index(['company_id', 'send_date']);
            $table->foreign('from_currency')->references('code')->on('currencies');
            $table->foreign('to_currency')->references('code')->on('currencies');
        });
        foreach ([
            'fund_transfers_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'fund_transfers_posted_complete' => "status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND posted_at IS NOT NULL AND send_journal_id IS NOT NULL)",
            'fund_transfers_amounts_check' => 'from_amount_fc > 0 AND to_amount_fc > 0 AND send_base > 0 AND fee_fc >= 0 AND send_rate > 0 AND receive_rate > 0',
            'fund_transfers_accounts_differ' => 'from_bank_account_id <> to_bank_account_id',
            'fund_transfers_fee_account' => 'fee_fc = 0 OR fee_account_id IS NOT NULL',
            'fund_transfers_completed_check' => "leg_state <> 'completed' OR (receive_journal_id IS NOT NULL AND received_on IS NOT NULL AND receive_base IS NOT NULL AND fx_difference IS NOT NULL)",
            'fund_transfers_dates_check' => 'received_on IS NULL OR received_on >= send_date',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE fund_transfers ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        Rls::enable(DB::connection(), 'fund_transfers');

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER fund_transfers_posted_row_guard
              BEFORE UPDATE OR DELETE ON fund_transfers
              FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'leg_state', 'receive_rate', 'to_amount_fc', 'receive_base', 'received_on', 'fx_difference', 'receive_journal_id', 'send_reversal_journal_id', 'receive_reversal_journal_id', 'received_by', 'lock_version', 'updated_at');
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('fund_transfers');
    }
};
