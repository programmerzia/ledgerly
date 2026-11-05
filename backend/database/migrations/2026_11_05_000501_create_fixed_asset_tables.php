<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fixed assets (05 §11 as built, 13 §23 D15.1, plan 3c.13): categories, the register and an append-only movement log.
 *
 * The register row carries the running figures (cost, accumulated depreciation, accumulated impairment, revaluation
 * reserve) so screens do not sum a log, but every change of them is also one row in `asset_movements`, and the figures
 * must equal the sum of the movements (a test checks it). A reversal is a new movement with the opposite signs; nothing
 * is edited or deleted. The movement log is also the source of the asset schedule, so it ties to the ledger.
 *
 * `source_type`/`source_id` is the posted line an asset was capitalised from; the partial unique index is what stops
 * one line becoming two assets. Capitalising posts nothing: the bill or journal already carries the cost.
 * Rates are stored as integer basis points per year, never as floats.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('asset_categories', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('name', 120);
            Rls::companyRef($table, 'asset_account_id', 'accounts');
            Rls::companyRef($table, 'accumulated_account_id', 'accounts');
            Rls::companyRef($table, 'expense_account_id', 'accounts');
            $table->string('measurement_model', 16)->default('cost');
            $table->string('default_method', 24)->default('straight_line');
            $table->integer('default_life_months')->nullable();
            $table->integer('default_declining_rate_bp')->nullable();
            $table->boolean('is_depreciable')->default(true);
            $table->boolean('is_active')->default(true);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['company_id', 'name']);
        });
        DB::statement("ALTER TABLE asset_categories ADD CONSTRAINT asset_categories_model_check CHECK (measurement_model IN ('cost', 'revaluation'))");
        DB::statement("ALTER TABLE asset_categories ADD CONSTRAINT asset_categories_method_check CHECK (default_method IN ('straight_line', 'declining_balance', 'units_of_production'))");
        DB::statement('ALTER TABLE asset_categories ADD CONSTRAINT asset_categories_defaults_check CHECK ((default_life_months IS NULL OR default_life_months BETWEEN 1 AND 1200) AND (default_declining_rate_bp IS NULL OR default_declining_rate_bp BETWEEN 1 AND 10000))');
        Rls::enable(DB::connection(), 'asset_categories');

        Schema::create('fixed_assets', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('number', 32);
            $table->string('name', 200);
            $table->text('description')->nullable();
            Rls::companyRef($table, 'category_id', 'asset_categories');
            $table->string('status', 16)->default('active');
            $table->date('acquired_on');
            $table->date('available_from');
            $table->date('disposed_on')->nullable();
            $table->bigInteger('acquisition_cost');
            $table->bigInteger('cost');
            $table->bigInteger('residual')->default(0);
            $table->bigInteger('accumulated_depreciation')->default(0);
            $table->bigInteger('accumulated_impairment')->default(0);
            $table->bigInteger('revaluation_reserve')->default(0);
            $table->bigInteger('revaluation_deficit')->default(0);
            $table->bigInteger('counterfactual_carrying')->nullable();
            $table->string('method', 24)->default('straight_line');
            $table->integer('useful_life_months')->nullable();
            $table->integer('declining_rate_bp')->nullable();
            $table->bigInteger('units_total')->nullable();
            $table->bigInteger('units_used')->default(0);
            $table->integer('months_charged')->default(0);
            $table->date('depreciated_through')->nullable();
            $table->boolean('is_opening')->default(false);
            $table->bigInteger('opening_accumulated')->default(0);
            $table->date('opening_as_of')->nullable();
            $table->string('source_type', 24)->nullable();
            $table->uuid('source_id')->nullable();
            $table->uuid('source_journal_id')->nullable();
            for ($p = 1; $p <= 8; $p++) {
                Rls::companyRef($table, "dim{$p}_value_id", 'dimension_values', nullable: true);
            }
            $table->integer('lock_version')->default(0);
            $table->uuid('created_by')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'number']);
            $table->index(['company_id', 'category_id']);
            $table->index(['company_id', 'status']);
        });
        foreach ([
            'fixed_assets_status_check' => "status IN ('active', 'disposed')",
            'fixed_assets_method_check' => "method IN ('straight_line', 'declining_balance', 'units_of_production')",
            'fixed_assets_amounts_check' => "acquisition_cost > 0 AND (cost > 0 OR status = 'disposed') AND residual >= 0 AND accumulated_depreciation >= 0 AND accumulated_impairment >= 0 AND revaluation_reserve >= 0 AND revaluation_deficit >= 0 AND units_used >= 0 AND months_charged >= 0 AND opening_accumulated >= 0",
            // A disposed asset's figures are zeroed by the disposal movement; until then carrying amount never goes below zero.
            'fixed_assets_carrying_check' => "status = 'disposed' OR cost - accumulated_depreciation - accumulated_impairment >= residual",
            'fixed_assets_estimates_check' => '(useful_life_months IS NULL OR useful_life_months BETWEEN 1 AND 1200) AND (declining_rate_bp IS NULL OR declining_rate_bp BETWEEN 1 AND 10000) AND (units_total IS NULL OR units_total > 0)',
            'fixed_assets_source_pair_check' => '(source_type IS NULL) = (source_id IS NULL)',
        ] as $name => $expression) {
            DB::statement("ALTER TABLE fixed_assets ADD CONSTRAINT {$name} CHECK ({$expression})");
        }
        // One posted line, one asset: a bill line or journal line cannot be capitalised twice.
        DB::statement('CREATE UNIQUE INDEX fixed_assets_one_per_source ON fixed_assets (company_id, source_type, source_id) WHERE source_id IS NOT NULL');
        Rls::enable(DB::connection(), 'fixed_assets');

        Schema::create('asset_movements', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'asset_id', 'fixed_assets');
            Rls::companyRef($table, 'category_id', 'asset_categories');
            $table->date('movement_date');
            $table->string('kind', 24);
            $table->bigInteger('cost_delta')->default(0);
            $table->bigInteger('depreciation_delta')->default(0);
            $table->bigInteger('impairment_delta')->default(0);
            $table->bigInteger('reserve_delta')->default(0);
            $table->bigInteger('deficit_delta')->default(0);
            $table->integer('months_delta')->default(0);
            $table->bigInteger('units_delta')->default(0);
            Rls::companyRef($table, 'journal_id', 'journals', nullable: true);
            $table->string('document_type', 32)->nullable();
            $table->uuid('document_id')->nullable();
            $table->jsonb('meta')->default('{}');
            $table->timestampTz('created_at')->useCurrent();
            $table->index(['company_id', 'movement_date']);
            $table->index(['asset_id', 'movement_date']);
            $table->index(['document_type', 'document_id']);
        });
        DB::statement("ALTER TABLE asset_movements ADD CONSTRAINT asset_movements_kind_check CHECK (kind IN ('opening', 'addition', 'depreciation', 'disposal', 'impairment', 'impairment_reversal', 'revaluation', 'reversal'))");
        Rls::enable(DB::connection(), 'asset_movements');

        // Append-only: a correction is another movement (LG030), like the ledger itself.
        DB::unprepared(<<<'SQL'
            CREATE OR REPLACE FUNCTION asset_movements_guard() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
              IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN
                RETURN OLD;
              END IF;
              RAISE EXCEPTION 'asset_movements_guard: movements are append-only' USING ERRCODE = 'LG030';
            END
            $$;

            CREATE TRIGGER asset_movements_guard
              BEFORE UPDATE OR DELETE ON asset_movements
              FOR EACH ROW EXECUTE FUNCTION asset_movements_guard();
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('DROP FUNCTION IF EXISTS asset_movements_guard() CASCADE');
        Schema::dropIfExists('asset_movements');
        Schema::dropIfExists('fixed_assets');
        Schema::dropIfExists('asset_categories');
    }
};
