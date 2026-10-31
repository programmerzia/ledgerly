<?php

declare(strict_types=1);

use Illuminate\Routing\Route as RouteDefinition;
use Illuminate\Support\Facades\Route;

/*
 * Every route the app exposes is either under /api/v1 (behind the API middleware stack) or on this
 * allowlist. Installing a package that registers routes of its own fails this test until the route
 * is deliberately allowed or switched off.
 */
it('exposes only the API and allowlisted framework routes', function (): void {
    $allowedPrefixes = [
        'api/v1/',
        'horizon',           // gated: local only until the admin guard (4b.1)
        'docs/api',          // Scramble: local only (config/scramble.php)
        '_scramble/',
        'sanctum/csrf-cookie',
        'storage/',          // local disk serving; attachments use signed URLs (2.17)
        'up',
    ];

    $unexpected = collect(Route::getRoutes()->getRoutes())
        ->map(fn (RouteDefinition $route): string => $route->uri())
        ->reject(fn (string $uri): bool => collect($allowedPrefixes)->contains(
            fn (string $prefix): bool => $uri === rtrim($prefix, '/') || str_starts_with($uri, $prefix),
        ))
        ->values()
        ->all();

    expect($unexpected)->toBe([]);
});
