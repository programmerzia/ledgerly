<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Templates say which of their lines are the posting accounts, so a new company can post without further setup. */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('chart_templates', function (Blueprint $table) {
            $table->jsonb('posting_accounts')->default('{}');
        });

        foreach (glob(database_path('seeders/charts/*.php')) ?: [] as $file) {
            /** @var array{code: string, posting_accounts: array<string, string>} $chart */
            $chart = require $file;
            DB::table('chart_templates')->where('code', $chart['code'])
                ->update(['posting_accounts' => json_encode($chart['posting_accounts'], JSON_THROW_ON_ERROR)]);
        }
    }

    public function down(): void
    {
        Schema::table('chart_templates', function (Blueprint $table) {
            $table->dropColumn('posting_accounts');
        });
    }
};
