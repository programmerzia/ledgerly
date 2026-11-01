<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Tax codes, their dated rates and tax groups (05 §8, plan 2.10). A rate is a fraction (0.050000 = 5%) and a
 * code's rates never overlap (exclusion constraint), so the rate on a date is unambiguous. Rates are
 * append-only history: a new rate closes the open one, nothing is edited or deleted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tax_codes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('code', 32);
            $table->string('name');
            $table->enum('kind', ['vat', 'gst', 'sales', 'wht', 'compound', 'exempt', 'zero', 'reverse_charge']);
            Rls::companyRef($table, 'collect_account_id', 'accounts', nullable: true);
            Rls::companyRef($table, 'pay_account_id', 'accounts', nullable: true);
            $table->boolean('is_recoverable')->default(false);
            $table->boolean('is_active')->default(true);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'code']);
            $table->unique(['tenant_id', 'company_id', 'id']);
        });
        Rls::enable(DB::connection(), 'tax_codes');

        Schema::create('tax_rates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'tax_code_id', 'tax_codes');
            $table->decimal('rate', 9, 6);
            $table->date('effective_from');
            $table->date('effective_to')->nullable();
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['tax_code_id', 'effective_from']);
        });
        DB::statement('ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_rate_check CHECK (rate >= 0 AND rate <= 1)');
        DB::statement('ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_dates_check CHECK (effective_to IS NULL OR effective_to >= effective_from)');
        DB::statement("ALTER TABLE tax_rates ADD CONSTRAINT tax_rates_no_overlap EXCLUDE USING gist (tax_code_id WITH =, daterange(effective_from, effective_to, '[]') WITH &&)");
        Rls::enable(DB::connection(), 'tax_rates');

        Schema::create('tax_groups', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('code', 32);
            $table->string('name');
            $table->boolean('is_active')->default(true);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'code']);
            $table->unique(['tenant_id', 'company_id', 'id']);
        });
        Rls::enable(DB::connection(), 'tax_groups');

        Schema::create('tax_group_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'tax_group_id', 'tax_groups');
            Rls::companyRef($table, 'tax_code_id', 'tax_codes');
            $table->smallInteger('sequence');
            $table->boolean('compound')->default(false);
            $table->timestampsTz();
            $table->unique(['tax_group_id', 'sequence']);
            $table->unique(['tax_group_id', 'tax_code_id']);
        });
        DB::statement('ALTER TABLE tax_group_items ADD CONSTRAINT tax_group_items_sequence_check CHECK (sequence >= 1)');
        Rls::enable(DB::connection(), 'tax_group_items');
    }

    public function down(): void
    {
        Schema::dropIfExists('tax_group_items');
        Schema::dropIfExists('tax_groups');
        Schema::dropIfExists('tax_rates');
        Schema::dropIfExists('tax_codes');
    }
};
