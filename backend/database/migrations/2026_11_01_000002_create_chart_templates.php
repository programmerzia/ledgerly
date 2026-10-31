<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Chart-of-accounts templates (05 §3, plan 2.1). Reference data shared by every tenant, like
 * `currencies`: no tenant_id and no RLS (it is on Rls::GLOBAL_TABLES). The four starter charts are
 * loaded from database/seeders/charts; change one later with a new migration that upserts by code.
 */
return new class extends Migration
{
    /** Display order of the starter charts. */
    private const array STARTER_CHARTS = ['ifrs_sme', 'us_small_business', 'non_profit', 'insurance'];

    public function up(): void
    {
        Schema::create('chart_templates', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('code', 64)->unique();
            $table->string('name');
            $table->char('country', 2)->nullable();
            $table->string('standard');
            $table->jsonb('lines');
            $table->timestampsTz();
        });

        foreach (self::STARTER_CHARTS as $code) {
            /** @var array{code: string, name: string, country: string|null, standard: string, lines: list<array<string, mixed>>} $chart */
            $chart = require database_path("seeders/charts/{$code}.php");

            DB::table('chart_templates')->insert([
                'id' => (string) Str::uuid7(),
                'code' => $chart['code'],
                'name' => $chart['name'],
                'country' => $chart['country'],
                'standard' => $chart['standard'],
                'lines' => json_encode($chart['lines'], JSON_THROW_ON_ERROR),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('chart_templates');
    }
};
