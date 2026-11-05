<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Bad-debt provisioning (13 §23 D15 item 2, IFRS 9 simplified matrix, plan 3c.10). `provision_rates` holds one rate per aging
 * bucket per company, as a percentage (2.5000 is 2.5%), editable; rates are data, nothing is assumed when none are set.
 * `provision_runs` is the approved document: for an as-of date in an open period it stores the required allowance by bucket, the
 * allowance already held and the difference (`detail` keeps the buckets, rates and balances so the run can be read later). It
 * posts only the difference, and is never auto-reversing. One run per period unless the earlier run was reversed or voided.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('provision_rates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->enum('bucket', ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90']);
            $table->decimal('rate_pct', 7, 4);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['company_id', 'bucket']);
        });
        DB::statement('ALTER TABLE provision_rates ADD CONSTRAINT provision_rates_range_check CHECK (rate_pct >= 0 AND rate_pct <= 100)');
        Rls::enable(DB::connection(), 'provision_rates');

        Schema::create('provision_runs', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32)->nullable();
            $table->enum('status', ['draft', 'pending_approval', 'posted', 'reversed', 'void'])->default('draft');
            Rls::companyRef($table, 'fiscal_period_id', 'fiscal_periods');
            $table->date('as_of');
            $table->bigInteger('required');
            $table->bigInteger('existing');
            $table->bigInteger('difference');
            $table->jsonb('detail');
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
        });
        foreach ([
            'provision_runs_maker_checker' => 'approved_by IS NULL OR approved_by IS DISTINCT FROM created_by',
            'provision_runs_posted_complete' => "status NOT IN ('posted', 'reversed') OR (number IS NOT NULL AND posted_at IS NOT NULL AND journal_id IS NOT NULL)",
            'provision_runs_amounts_check' => 'required >= 0 AND difference = required - existing AND difference <> 0',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE provision_runs ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        DB::statement("CREATE UNIQUE INDEX provision_runs_one_per_period ON provision_runs (company_id, fiscal_period_id) WHERE status NOT IN ('void', 'reversed')");
        Rls::enable(DB::connection(), 'provision_runs');

        DB::unprepared(<<<'SQL'
            CREATE TRIGGER provision_runs_posted_row_guard
              BEFORE UPDATE OR DELETE ON provision_runs
              FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'reversal_journal_id', 'lock_version', 'updated_at');
            SQL);
    }

    public function down(): void
    {
        Schema::dropIfExists('provision_runs');
        Schema::dropIfExists('provision_rates');
    }
};
