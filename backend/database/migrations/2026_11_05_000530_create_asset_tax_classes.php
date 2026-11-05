<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Tax depreciation classes (13 §23 D15.1 and D15.10, plan 3c.15b): data, not code. A class has an annual rate on cost and an optional
 * first-year rate, both in basis points; an asset may name one. The schedule they drive is a report and never posts. Rates are
 * entered by the company now and seeded by a country pack later (`source` says which); no country's rates are built in.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('asset_tax_classes', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('code', 32);
            $table->string('name', 120);
            $table->integer('annual_rate_bp');
            $table->integer('first_year_rate_bp')->nullable();
            $table->string('source', 24)->default('company');
            $table->boolean('is_active')->default(true);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->unique(['company_id', 'code']);
        });
        DB::statement('ALTER TABLE asset_tax_classes ADD CONSTRAINT asset_tax_classes_rates_check CHECK (annual_rate_bp BETWEEN 1 AND 10000 AND (first_year_rate_bp IS NULL OR first_year_rate_bp BETWEEN 1 AND 10000))');
        Rls::enable(DB::connection(), 'asset_tax_classes');

        Schema::table('fixed_assets', function (Blueprint $table) {
            $table->uuid('tax_class_id')->nullable();
            $table->foreign(['tenant_id', 'company_id', 'tax_class_id'])->references(['tenant_id', 'company_id', 'id'])->on('asset_tax_classes')->restrictOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('fixed_assets', function (Blueprint $table) {
            $table->dropForeign(['tenant_id', 'company_id', 'tax_class_id']);
            $table->dropColumn('tax_class_id');
        });
        Schema::dropIfExists('asset_tax_classes');
    }
};
