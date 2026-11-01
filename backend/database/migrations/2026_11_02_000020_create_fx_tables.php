<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Exchange rates and unrealised-FX revaluation runs (05 §5, 13 §8). `rate` is base units per 1 unit of
 * `from_currency` as the provider or the user states it; D1 keeps it at numeric(20,8). The run table
 * names its period `fiscal_period_id` like every other table (05 says `period_id`).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('exchange_rates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->char('from_currency', 3);
            $table->char('to_currency', 3);
            $table->date('rate_date');
            $table->decimal('rate', 20, 8);
            $table->enum('source', ['manual', 'provider', 'document']);
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->unique(['company_id', 'from_currency', 'to_currency', 'rate_date', 'source']);
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'from_currency', 'to_currency', 'rate_date']);
            $table->foreign('from_currency')->references('code')->on('currencies');
            $table->foreign('to_currency')->references('code')->on('currencies');
        });
        DB::statement('ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_rate_positive CHECK (rate > 0)');
        DB::statement('ALTER TABLE exchange_rates ADD CONSTRAINT exchange_rates_distinct_currencies CHECK (from_currency <> to_currency)');
        Rls::enable(DB::connection(), 'exchange_rates');

        Schema::create('fx_revaluations', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'fiscal_period_id', 'fiscal_periods');
            $table->date('as_of');
            // `posted`: the run happened (its journal, if any, is posted). `reversed` is a run undone as a whole
            // and `void` one that never took effect; both free the period for a new run. The automatic reversal
            // next period does NOT change the status: it sets reversal_journal_id (null while pending).
            $table->enum('status', ['posted', 'void', 'reversed'])->default('posted');
            Rls::companyRef($table, 'journal_id', 'journals', nullable: true);
            Rls::companyRef($table, 'reversal_journal_id', 'journals', nullable: true);
            $table->char('base_currency', 3);
            $table->bigInteger('total_unrealised')->default(0);
            $table->jsonb('detail')->default('{}');
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'as_of']);
            $table->foreign('base_currency')->references('code')->on('currencies');
        });
        DB::statement("CREATE UNIQUE INDEX fx_revaluations_one_per_period ON fx_revaluations (company_id, fiscal_period_id) WHERE status NOT IN ('void', 'reversed')");
        Rls::enable(DB::connection(), 'fx_revaluations');
    }

    public function down(): void
    {
        Schema::dropIfExists('fx_revaluations');
        Schema::dropIfExists('exchange_rates');
    }
};
