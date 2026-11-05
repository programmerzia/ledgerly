<?php

declare(strict_types=1);

use App\Domain\Shared\FormatPreferences;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * A company's date and number format (plan 3c.26b). Null means "the usual way in the company's country", so nothing changes for a company
 * until it chooses, and a company that never chooses follows its country.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('company_settings', function (Blueprint $table) {
            $table->string('date_format', 16)->nullable();
            $table->string('number_format', 16)->nullable();
        });
        $dates = "'".implode("', '", array_keys(FormatPreferences::DATE_FORMATS))."'";
        $numbers = "'".implode("', '", array_keys(FormatPreferences::NUMBER_FORMATS))."'";
        DB::statement("ALTER TABLE company_settings ADD CONSTRAINT company_settings_date_format_check CHECK (date_format IS NULL OR date_format IN ({$dates}))");
        DB::statement("ALTER TABLE company_settings ADD CONSTRAINT company_settings_number_format_check CHECK (number_format IS NULL OR number_format IN ({$numbers}))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE company_settings DROP CONSTRAINT company_settings_number_format_check');
        DB::statement('ALTER TABLE company_settings DROP CONSTRAINT company_settings_date_format_check');
        Schema::table('company_settings', function (Blueprint $table) {
            $table->dropColumn(['date_format', 'number_format']);
        });
    }
};
