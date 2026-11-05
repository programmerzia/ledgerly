<?php

declare(strict_types=1);

/**
 * Plan 3c.24 follow-up: in live mode the sidebar comes from database/seeders/menu_items.php, so a screen added to the SPA's nav.ts and
 * liveRoutes.ts without a seeded row would vanish from the menu. This fails when that happens.
 */
$root = dirname(__DIR__, 3);

/** @return list<array<string, mixed>> */
$rows = function () use ($root): array {
    $sections = require $root.'/backend/database/seeders/menu_items.php';

    return array_merge(...array_map(fn (array $s) => $s['items'], $sections));
};

it('has a seeded menu row for every live item in the SPA nav', function () use ($root, $rows): void {
    $nav = (string) file_get_contents($root.'/frontend/src/layouts/shell/nav.ts');
    $live = (string) file_get_contents($root.'/frontend/src/data/liveRoutes.ts');
    preg_match_all('~to: `/\$\{coSlug\}/([^`]*)`~', $nav, $navRoutes);
    preg_match('~LIVE_ROUTES: readonly RegExp\[\] = \[(.*)\];~', $live, $list);
    preg_match_all('~/(\^.*?\$)/(?=,|\s*$)~', $list[1] ?? '', $patterns);
    expect($navRoutes[1])->not->toBeEmpty()->and($patterns[1])->not->toBeEmpty();

    $seeded = array_column($rows(), 'route');
    $missing = [];
    foreach (array_unique($navRoutes[1]) as $route) {
        $isLive = array_filter($patterns[1], fn (string $p) => preg_match('~'.str_replace('~', '\~', str_replace('\/', '/', $p)).'~', $route) === 1) !== [];
        if ($isLive && ! in_array($route, $seeded, true)) {
            $missing[] = $route;
        }
    }

    expect($missing)->toBe([], 'nav.ts live screens with no row in database/seeders/menu_items.php');
});

it('maps every seeded icon in navIcons.ts', function () use ($root, $rows): void {
    $icons = (string) file_get_contents($root.'/frontend/src/layouts/shell/navIcons.ts');
    $unmapped = array_values(array_filter(array_unique(array_column($rows(), 'icon')), fn (string $i) => ! str_contains($icons, "'{$i}'") && ! preg_match('~^\s*'.preg_quote($i, '~').':~m', $icons)));

    expect($unmapped)->toBe([]);
});
