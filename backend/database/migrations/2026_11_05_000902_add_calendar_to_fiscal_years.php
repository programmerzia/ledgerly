<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Week-based fiscal calendars (plan 3c.26a, PRD §4.3). A year says how its periods were cut: `monthly` (every existing year) or a 4-4-5,
 * 4-5-4 or 5-4-4 week pattern, and for a 53-week year which period took the extra week. The periods themselves are still plain date ranges.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('fiscal_years', function (Blueprint $table) {
            $table->string('calendar', 16)->default('monthly');
            $table->smallInteger('extra_week_period')->nullable();
        });
        DB::statement("ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_calendar_check CHECK (calendar IN ('monthly', '4-4-5', '4-5-4', '5-4-4'))");
        DB::statement("ALTER TABLE fiscal_years ADD CONSTRAINT fiscal_years_extra_week_check CHECK (extra_week_period IS NULL OR (calendar <> 'monthly' AND extra_week_period BETWEEN 1 AND 12))");
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE fiscal_years DROP CONSTRAINT fiscal_years_extra_week_check');
        DB::statement('ALTER TABLE fiscal_years DROP CONSTRAINT fiscal_years_calendar_check');
        Schema::table('fiscal_years', function (Blueprint $table) {
            $table->dropColumn(['calendar', 'extra_week_period']);
        });
    }
};
