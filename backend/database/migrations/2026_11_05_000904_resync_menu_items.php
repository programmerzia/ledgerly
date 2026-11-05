<?php

declare(strict_types=1);

use App\Support\Menu\MenuItemSeeder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Loads database/seeders/menu_items.php again after the fixed assets, budgets and listing-report screens joined the menu (merge of plan
 * 3c.24 with the work done beside it). `sync()` upserts by key, so a database that already ran 000900 gains the new rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        MenuItemSeeder::sync(DB::connection());
    }

    public function down(): void
    {
        // The rows stay; the list is reference data.
    }
};
