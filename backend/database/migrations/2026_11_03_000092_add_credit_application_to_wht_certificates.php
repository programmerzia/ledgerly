<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** A certificate issued by applying a payment's credit is voided when that application is undone. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('wht_certificates', function (Blueprint $table) {
            $table->uuid('credit_application_id')->nullable();
            $table->index('credit_application_id');
        });
    }

    public function down(): void
    {
        Schema::table('wht_certificates', function (Blueprint $table) {
            $table->dropColumn('credit_application_id');
        });
    }
};
