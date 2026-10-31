<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Tenants, memberships, currencies, companies (05 §1–2, §5; 13 §6, §22). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tenants', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('name');
            $table->string('slug')->unique();
            $table->enum('lifecycle', ['trial', 'active', 'past_due', 'read_only', 'suspended', 'cancelled', 'deleted'])->default('trial');
            $table->timestampTz('trial_ends_at')->nullable();
            $table->boolean('legal_hold')->default(false);
            $table->date('archive_until')->nullable();
            $table->jsonb('settings')->default('{}');
            $table->timestampsTz();
        });

        Schema::create('tenant_users', function (Blueprint $table) {
            $table->uuid('tenant_id');
            $table->uuid('user_id');
            $table->enum('role', ['owner', 'admin', 'member'])->default('member');
            $table->enum('status', ['invited', 'active', 'disabled'])->default('active');
            $table->uuid('invited_by')->nullable();
            $table->timestampTz('joined_at')->nullable();
            $table->timestampsTz();
            $table->primary(['tenant_id', 'user_id']);
            $table->index('user_id');
            $table->foreign('tenant_id')->references('id')->on('tenants')->restrictOnDelete();
            $table->foreign('user_id')->references('id')->on('users')->restrictOnDelete();
        });

        Schema::create('currencies', function (Blueprint $table) {
            $table->char('code', 3)->primary();
            $table->string('name');
            $table->smallInteger('minor_unit');
            $table->string('symbol', 8)->nullable();
        });
        DB::table('currencies')->insert(array_map(
            fn (array $c) => ['code' => $c[0], 'name' => $c[1], 'minor_unit' => $c[2], 'symbol' => $c[3]],
            [
                ['USD', 'US Dollar', 2, '$'], ['EUR', 'Euro', 2, '€'], ['GBP', 'Pound Sterling', 2, '£'],
                ['BDT', 'Bangladeshi Taka', 2, '৳'], ['INR', 'Indian Rupee', 2, '₹'], ['AED', 'UAE Dirham', 2, null],
                ['SAR', 'Saudi Riyal', 2, null], ['SGD', 'Singapore Dollar', 2, 'S$'], ['AUD', 'Australian Dollar', 2, 'A$'],
                ['CAD', 'Canadian Dollar', 2, 'C$'], ['CHF', 'Swiss Franc', 2, null], ['CNY', 'Yuan Renminbi', 2, '¥'],
                ['JPY', 'Yen', 0, '¥'], ['KWD', 'Kuwaiti Dinar', 3, null], ['BHD', 'Bahraini Dinar', 3, null],
            ],
        ));

        Schema::create('companies', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            $table->string('name');
            $table->string('legal_name')->nullable();
            $table->string('slug');
            $table->char('country', 2);
            $table->char('base_currency', 3);
            $table->string('timezone', 64)->default('UTC');
            $table->string('locale', 16)->default('en');
            $table->smallInteger('fiscal_year_start_month')->default(1);
            $table->string('tax_id')->nullable();
            $table->jsonb('address')->nullable();
            $table->string('logo_path')->nullable();
            $table->jsonb('settings')->default('{}');
            $table->enum('status', ['active', 'archived'])->default('active');
            $table->timestampsTz();
            $table->unique(['tenant_id', 'slug']);
            $table->unique(['tenant_id', 'id']);
            $table->foreign('base_currency')->references('code')->on('currencies');
        });
        Rls::enable(DB::connection(), 'companies');

        Schema::create('company_settings', function (Blueprint $table) {
            Rls::tenantColumn($table);
            $table->uuid('company_id')->primary();
            $table->jsonb('posting_accounts')->default('{}');
            $table->jsonb('numbering')->default('{}');
            $table->jsonb('approval_defaults')->default('{}');
            $table->jsonb('document_templates')->default('{}');
            $table->enum('tax_rounding', ['document_per_code', 'line'])->default('document_per_code');
            $table->timestampsTz();
            $table->foreign(['tenant_id', 'company_id'])->references(['tenant_id', 'id'])->on('companies')->restrictOnDelete();
        });
        Rls::enable(DB::connection(), 'company_settings');
    }

    public function down(): void
    {
        Schema::dropIfExists('company_settings');
        Schema::dropIfExists('companies');
        Schema::dropIfExists('currencies');
        Schema::dropIfExists('tenant_users');
        Schema::dropIfExists('tenants');
    }
};
