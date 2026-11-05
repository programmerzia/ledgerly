<?php

declare(strict_types=1);

use App\Support\Menu\MenuItemSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The company menu (plan 3c.24): reference data shared by every tenant, so no tenant_id and no RLS (it is on Rls::GLOBAL_TABLES). The app
 * role can only read it; the list lives in database/seeders/menu_items.php and is loaded here, and again by any later migration that
 * changes the list.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('menu_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('key', 64)->unique();
            $table->string('section_key', 32);
            $table->string('section_title')->nullable();
            $table->smallInteger('section_sort');
            $table->boolean('section_collapsed')->default(false);
            $table->string('label');
            $table->string('icon', 48);
            $table->string('route');
            $table->smallInteger('sort_order');
            $table->jsonb('permissions')->default('[]');
            $table->string('module_key', 48)->nullable();
            $table->boolean('active')->default(true);
            $table->timestampsTz();
        });
        DB::statement('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON menu_items FROM ledgerly_app');

        MenuItemSeeder::sync(DB::connection());
    }

    public function down(): void
    {
        Schema::dropIfExists('menu_items');
    }
};
