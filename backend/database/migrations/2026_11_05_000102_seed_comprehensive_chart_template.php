<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Loads the Comprehensive (IFRS) chart (plan 3c.0, D15.8) from database/seeders/charts/comprehensive.php. */
return new class extends Migration
{
    public function up(): void
    {
        /** @var array{code: string, name: string, country: string|null, standard: string, recommended: bool, posting_accounts: array<string, string>, lines: list<array<string, mixed>>} $chart */
        $chart = require database_path('seeders/charts/comprehensive.php');

        $row = [
            'name' => $chart['name'],
            'country' => $chart['country'],
            'standard' => $chart['standard'],
            'lines' => json_encode($chart['lines'], JSON_THROW_ON_ERROR),
            'posting_accounts' => json_encode($chart['posting_accounts'], JSON_THROW_ON_ERROR),
            'is_recommended' => $chart['recommended'],
            'updated_at' => now(),
        ];
        if (DB::table('chart_templates')->where('code', $chart['code'])->exists()) {
            DB::table('chart_templates')->where('code', $chart['code'])->update($row);
        } else {
            DB::table('chart_templates')->insert($row + ['id' => (string) Str::uuid7(), 'code' => $chart['code'], 'created_at' => now()]);
        }
    }

    public function down(): void
    {
        DB::table('chart_templates')->where('code', 'comprehensive')->delete();
    }
};
