<?php

declare(strict_types=1);

namespace App\Queries\Menu;

use Illuminate\Support\Facades\DB;

/**
 * The company menu for one person (plan 3c.24): active `menu_items` rows whose required permission (any of the row's list; none = everyone)
 * the person holds in the company, grouped in sections. A row whose permission nobody holds is simply absent. Convenience only: the API
 * refuses what a role may not do whether or not the menu showed it.
 */
final class CompanyMenu
{
    /**
     * @param  list<string>  $held  permission names the person holds in the company
     * @return list<array{key: string, title: string|null, collapsed: bool, items: list<array{key: string, label: string, icon: string, route: string, module: string|null}>}>
     */
    public function __invoke(array $held): array
    {
        $sections = [];
        $rows = DB::table('menu_items')->where('active', true)->orderBy('section_sort')->orderBy('sort_order')->get();
        foreach ($rows as $row) {
            /** @var list<string> $needs */
            $needs = json_decode((string) $row->permissions, true, 8, JSON_THROW_ON_ERROR);
            if ($needs !== [] && array_intersect($needs, $held) === []) {
                continue;
            }
            $key = (string) $row->section_key;
            $sections[$key] ??= [
                'key' => $key, 'title' => $row->section_title === null ? null : (string) $row->section_title,
                'collapsed' => (bool) $row->section_collapsed, 'items' => [],
            ];
            $sections[$key]['items'][] = [
                'key' => (string) $row->key, 'label' => (string) $row->label, 'icon' => (string) $row->icon,
                'route' => (string) $row->route, 'module' => $row->module_key === null ? null : (string) $row->module_key,
            ];
        }

        return array_values($sections);
    }
}
