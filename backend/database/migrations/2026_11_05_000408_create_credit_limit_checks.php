<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Credit limit at invoice submit (plan 3c.12). `company_settings.credit_limit_mode` is off (default), warn or refuse; the limit itself
 * is the contact's existing `credit_limit`, in the contact's currency. `credit_limit_checks` keeps what the check found when it did not
 * simply pass: a warning shown at submit, or an override by a second person (with the reason), so the decision can be read later. It
 * mirrors `bill_match_results` of the three-way match.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TABLE company_settings ADD COLUMN credit_limit_mode varchar(8) NOT NULL DEFAULT 'off'");
        DB::statement("ALTER TABLE company_settings ADD CONSTRAINT company_settings_credit_limit_mode_check CHECK (credit_limit_mode IN ('off', 'warn', 'refuse'))");

        Schema::create('credit_limit_checks', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            Rls::companyRef($table, 'invoice_id', 'invoices');
            Rls::companyRef($table, 'contact_id', 'contacts');
            $table->enum('outcome', ['warned', 'overridden']);
            $table->bigInteger('exposure');
            $table->bigInteger('limit_base');
            $table->text('reason')->nullable();
            $table->uuid('decided_by')->nullable();
            $table->timestampTz('created_at');
            $table->index(['company_id', 'invoice_id']);
        });
        DB::statement("ALTER TABLE credit_limit_checks ADD CONSTRAINT credit_limit_checks_reason_check CHECK (outcome <> 'overridden' OR (reason IS NOT NULL AND length(btrim(reason)) > 0))");
        Rls::enable(DB::connection(), 'credit_limit_checks');
    }

    public function down(): void
    {
        Schema::dropIfExists('credit_limit_checks');
        DB::statement('ALTER TABLE company_settings DROP COLUMN credit_limit_mode');
    }
};
