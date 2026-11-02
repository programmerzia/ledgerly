<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Why a statement line was left out of the books, and who decided. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('bank_statement_lines', function (Blueprint $table) {
            $table->text('excluded_reason')->nullable();
            $table->uuid('excluded_by')->nullable();
            $table->timestampTz('excluded_at')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('bank_statement_lines', function (Blueprint $table) {
            $table->dropColumn(['excluded_reason', 'excluded_by', 'excluded_at']);
        });
    }
};
