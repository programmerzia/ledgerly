<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Plan 3c.0. `ifrs_element` links an account to an IFRS Accounting Taxonomy element (stored and shown, no report
 * uses it). `is_hidden` keeps specialist accounts out of default lists and pickers; it never affects posting,
 * reports or balances.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('accounts', function (Blueprint $table) {
            $table->string('ifrs_element', 255)->nullable();
            $table->boolean('is_hidden')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('accounts', function (Blueprint $table) {
            $table->dropColumn(['ifrs_element', 'is_hidden']);
        });
    }
};
