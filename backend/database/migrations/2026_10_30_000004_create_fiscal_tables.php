<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Fiscal calendar (05 §4) with the adjustment period (13 §23 D7). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fiscal_years', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('name', 32);
            $table->date('starts_on');
            $table->date('ends_on');
            $table->enum('status', ['open', 'closed', 'locked'])->default('open');
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'company_id', 'name']);
        });
        DB::statement("ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_no_overlap EXCLUDE USING gist (company_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&)");
        DB::statement('ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_range_check CHECK (ends_on >= starts_on)');
        Rls::enable(DB::connection(), 'fiscal_years');

        Schema::create('fiscal_periods', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'fiscal_year_id', 'fiscal_years');
            $table->smallInteger('number');
            $table->string('name', 64);
            $table->enum('kind', ['regular', 'adjustment'])->default('regular');
            $table->date('starts_on');
            $table->date('ends_on');
            $table->enum('status', ['open', 'soft_closed', 'closed', 'locked'])->default('open');
            $table->timestampTz('closed_at')->nullable();
            $table->uuid('closed_by')->nullable();
            $table->integer('reopened_count')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['tenant_id', 'fiscal_year_id', 'number']);
            $table->index(['company_id', 'starts_on', 'ends_on']);
        });
        DB::statement("ALTER TABLE fiscal_periods ADD CONSTRAINT fiscal_periods_no_overlap EXCLUDE USING gist (company_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&) WHERE (kind = 'regular')");
        DB::statement('CREATE UNIQUE INDEX fiscal_periods_one_adjustment ON fiscal_periods (fiscal_year_id) WHERE (kind = \'adjustment\')');
        DB::statement('ALTER TABLE fiscal_periods ADD CONSTRAINT fiscal_periods_range_check CHECK (ends_on >= starts_on)');
        Rls::enable(DB::connection(), 'fiscal_periods');
    }

    public function down(): void
    {
        Schema::dropIfExists('fiscal_periods');
        Schema::dropIfExists('fiscal_years');
    }
};
