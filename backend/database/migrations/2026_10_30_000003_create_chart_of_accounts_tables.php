<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Accounts and dimensions (05 §3) with composite tenant/company FKs (13 §6). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('accounts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('code', 32);
            $table->string('name');
            $table->enum('account_type', ['asset', 'liability', 'equity', 'income', 'expense']);
            $table->string('account_subtype', 64)->nullable();
            $table->enum('normal_balance', ['debit', 'credit']);
            $table->uuid('parent_id')->nullable();
            $table->enum('currency_policy', ['base_only', 'any', 'fixed'])->default('base_only');
            $table->char('fixed_currency', 3)->nullable();
            $table->enum('control_type', ['none', 'ar', 'ap', 'bank', 'cash', 'tax', 'retained_earnings', 'suspense', 'fixed_asset', 'accum_depr'])->default('none');
            $table->boolean('allow_manual_journals')->default(false);
            $table->boolean('is_postable')->default(true);
            $table->boolean('is_active')->default(true);
            $table->jsonb('reporting_tags')->default('[]');
            $table->text('description')->nullable();
            $table->timestampsTz();
            $table->softDeletesTz();
            $table->unique(['tenant_id', 'company_id', 'code']);
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'account_type']);
            $table->foreign('fixed_currency')->references('code')->on('currencies');
        });
        Schema::table('accounts', function (Blueprint $table) {
            $table->foreign(['tenant_id', 'company_id', 'parent_id'])->references(['tenant_id', 'company_id', 'id'])->on('accounts');
        });
        DB::statement("ALTER TABLE accounts ADD CONSTRAINT accounts_fixed_currency_check CHECK ((currency_policy = 'fixed') = (fixed_currency IS NOT NULL))");
        Rls::enable(DB::connection(), 'accounts');

        Schema::create('dimensions', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('code', 32);
            $table->string('name');
            $table->smallInteger('position');
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'code']);
            $table->unique(['tenant_id', 'company_id', 'position']);
            $table->unique(['tenant_id', 'company_id', 'id']);
        });
        DB::statement('ALTER TABLE dimensions ADD CONSTRAINT dimensions_position_check CHECK (position BETWEEN 1 AND 8)');
        Rls::enable(DB::connection(), 'dimensions');

        Schema::create('dimension_values', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'dimension_id', 'dimensions');
            $table->string('code', 32);
            $table->string('name');
            $table->uuid('parent_id')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'dimension_id', 'code']);
            $table->unique(['tenant_id', 'company_id', 'id']);
        });
        Rls::enable(DB::connection(), 'dimension_values');

        Schema::create('account_dimension_rules', function (Blueprint $table) {
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'account_id', 'accounts');
            Rls::companyRef($table, 'dimension_id', 'dimensions');
            $table->enum('rule', ['required', 'optional', 'forbidden']);
            $table->primary(['tenant_id', 'account_id', 'dimension_id']);
        });
        Rls::enable(DB::connection(), 'account_dimension_rules');
    }

    public function down(): void
    {
        Schema::dropIfExists('account_dimension_rules');
        Schema::dropIfExists('dimension_values');
        Schema::dropIfExists('dimensions');
        Schema::dropIfExists('accounts');
    }
};
