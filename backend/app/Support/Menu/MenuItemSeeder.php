<?php

declare(strict_types=1);

namespace App\Support\Menu;

use Illuminate\Database\ConnectionInterface;
use Illuminate\Support\Str;

/**
 * Loads database/seeders/menu_items.php into `menu_items`, upserting by key (plan 3c.24). Run by a migration or deploy step on the owner
 * connection: the app role can only read the table. Safe to run again; rows not in the list are left alone.
 */
final class MenuItemSeeder
{
    public static function sync(ConnectionInterface $db): void
    {
        /** @var list<array{key: string, title: string|null, collapsed?: bool, items: list<array<string, mixed>>}> $sections */
        $sections = require database_path('seeders/menu_items.php');
        $now = now();
        foreach ($sections as $sectionIndex => $section) {
            foreach ($section['items'] as $itemIndex => $item) {
                $values = [
                    'section_key' => $section['key'],
                    'section_title' => $section['title'],
                    'section_sort' => ($sectionIndex + 1) * 10,
                    'section_collapsed' => $section['collapsed'] ?? false,
                    'label' => $item['label'],
                    'icon' => $item['icon'],
                    'route' => $item['route'],
                    'sort_order' => ($itemIndex + 1) * 10,
                    'permissions' => json_encode($item['permissions'], JSON_THROW_ON_ERROR),
                    'module_key' => $item['module'] ?? null,
                    'active' => $item['active'] ?? true,
                    'updated_at' => $now,
                ];
                if ($db->table('menu_items')->where('key', $item['key'])->exists()) {
                    $db->table('menu_items')->where('key', $item['key'])->update($values);
                } else {
                    $db->table('menu_items')->insert($values + ['id' => (string) Str::uuid7(), 'key' => $item['key'], 'created_at' => $now]);
                }
            }
        }
    }
}
