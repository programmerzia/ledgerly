<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** The onboarding picker offers the recommended template first (plan 3c.0). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chart_templates', function (Blueprint $table) {
            $table->boolean('is_recommended')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('chart_templates', function (Blueprint $table) {
            $table->dropColumn('is_recommended');
        });
    }
};
