<?php

declare(strict_types=1);

use App\Support\Database\Rls;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Products and services (05 §9, plan 2.11). An item only supplies defaults for a document line (account,
 * tax code, price); the line keeps its own copies, so changing an item never changes a posted document.
 * Items are deactivated, never deleted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            Rls::tenantColumn($table);
            Rls::companyColumn($table);
            $table->string('code', 32);
            $table->string('name');
            $table->text('description')->nullable();
            $table->enum('kind', ['service', 'good']);
            Rls::companyRef($table, 'sales_account_id', 'accounts', nullable: true);
            Rls::companyRef($table, 'purchase_account_id', 'accounts', nullable: true);
            $table->bigInteger('sales_price')->default(0);
            $table->bigInteger('purchase_price')->default(0);
            $table->char('currency', 3);
            Rls::companyRef($table, 'tax_code_id', 'tax_codes', nullable: true);
            $table->boolean('is_active')->default(true);
            $table->integer('lock_version')->default(0);
            $table->timestampsTz();
            $table->unique(['tenant_id', 'company_id', 'code']);
            $table->unique(['tenant_id', 'company_id', 'id']);
            $table->index(['company_id', 'is_active']);
            $table->foreign('currency')->references('code')->on('currencies');
        });
        DB::statement('ALTER TABLE items ADD CONSTRAINT items_prices_check CHECK (sales_price >= 0 AND purchase_price >= 0)');
        Rls::enable(DB::connection(), 'items');
    }

    public function down(): void
    {
        Schema::dropIfExists('items');
    }
};
