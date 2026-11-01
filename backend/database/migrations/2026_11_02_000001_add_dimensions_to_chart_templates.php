<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Templates can bring dimensions with their accounts: the non-profit chart brings Fund (D13). */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chart_templates', function (Blueprint $table) {
            $table->jsonb('dimensions')->default('[]');
        });

        /** @var array{code: string, dimensions: list<array<string, mixed>>} $chart */
        $chart = require database_path('seeders/charts/non_profit.php');
        DB::table('chart_templates')->where('code', $chart['code'])
            ->update(['dimensions' => json_encode($chart['dimensions'], JSON_THROW_ON_ERROR)]);
    }

    public function down(): void
    {
        Schema::table('chart_templates', function (Blueprint $table) {
            $table->dropColumn('dimensions');
        });
    }
};
