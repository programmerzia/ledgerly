<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Customers and suppliers (05 §7, plan 2.10). Contacts are deactivated, never deleted; their code stays theirs. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contacts', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->enum('kind', ['customer', 'supplier', 'both']);
            $table->string('code', 32);
            $table->string('name');
            $table->string('legal_name')->nullable();
            $table->string('tax_id', 64)->nullable();
            $table->string('email')->nullable();
            $table->string('phone', 64)->nullable();
            $table->jsonb('billing_address')->nullable();
            $table->jsonb('shipping_address')->nullable();
            $table->char('default_currency', 3);
            $table->smallInteger('payment_terms_days')->default(0);
            $table->bigInteger('credit_limit')->nullable();
            Rls::companyRef($table, 'ar_account_id', 'accounts', nullable: true);
            Rls::companyRef($table, 'ap_account_id', 'accounts', nullable: true);
            Rls::companyRef($table, 'wht_code_id', 'tax_codes', nullable: true);
            // Pre-fill for new documents (the mock's E3): coding account, tax code and branch.
            Rls::companyRef($table, 'default_account_id', 'accounts', nullable: true);
            Rls::companyRef($table, 'default_tax_code_id', 'tax_codes', nullable: true);
            $table->string('default_branch', 64)->nullable();
            $table->jsonb('default_dims')->default('{}');
            $table->boolean('is_active')->default(true);
            $table->text('notes')->nullable();
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->softDeletesTz();
            $table->unique(['tenant_id', 'company_id', 'code']);
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'kind']);
            $table->foreign('default_currency')->references('code')->on('currencies');
        });
        DB::statement('ALTER TABLE contacts ADD CONSTRAINT contacts_terms_check CHECK (payment_terms_days >= 0)');
        DB::statement('ALTER TABLE contacts ADD CONSTRAINT contacts_credit_limit_check CHECK (credit_limit IS NULL OR credit_limit >= 0)');
        Rls::enable(DB::connection(), 'contacts');
    }

    public function down(): void
    {
        Schema::dropIfExists('contacts');
    }
};
