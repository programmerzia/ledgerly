<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** Optimistic locking for the editable setup records the API exposes (13 §11: every mutable resource has a version). */
return new class extends Migration
{
    private const array TABLES = ['accounts', 'dimensions', 'dimension_values', 'approval_workflows'];

    public function up(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $t): void {
                $t->integer('lock_version')->default(0);
            });
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $table) {
            Schema::table($table, function (Blueprint $t): void {
                $t->dropColumn('lock_version');
            });
        }
    }
};
