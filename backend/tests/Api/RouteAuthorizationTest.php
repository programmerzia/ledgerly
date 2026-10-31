<?php

declare(strict_types=1);

use App\Http\Middleware\RequireIdempotencyKey;
use App\Http\Middleware\ResolveCompany;
use App\Http\Middleware\ResolveTenant;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;

/*
 * 13 §7: every API route is authorized by a policy (`#[Authorize]` on the controller method or
 * `can:` middleware). Only routes that run before a tenant or a session exists are exempt, each
 * with its reason, and the exemption list cannot go stale.
 */

const EXEMPT_ROUTES = [
    'register.store' => 'sign-up: no account yet',
    'session.me' => 'the signed-in user\'s own profile',
    'session.tenant' => 'switch organisation; membership checked in the controller',
    'invitation-tokens.show' => 'the invitation token is the credential',
    'invitation-tokens.accept' => 'the invitation token is the credential; the Action checks the email',
];

/** @return list<Route> */
function apiRoutes(): array
{
    return array_values(array_filter(
        Router::getRoutes()->getRoutes(),
        fn (Route $r): bool => str_starts_with($r->uri(), 'api/v1/'),
    ));
}

function isFortify(Route $route): bool
{
    return str_starts_with((string) $route->getControllerClass(), 'Laravel\\Fortify\\');
}

it('authorizes every API route by policy, except the listed pre-tenant routes', function (): void {
    $unauthorized = collect(apiRoutes())
        ->reject(fn (Route $r) => isFortify($r) || array_key_exists((string) $r->getName(), EXEMPT_ROUTES))
        ->reject(fn (Route $r) => collect($r->gatherMiddleware())->contains(
            fn ($m) => is_string($m) && (str_starts_with($m, 'can:') || str_starts_with($m, 'Illuminate\\Auth\\Middleware\\Authorize:')),
        ))
        ->map(fn (Route $r) => implode('|', $r->methods()).' '.$r->uri())
        ->values()->all();

    expect($unauthorized)->toBe([]);
});

it('keeps the exemption list current', function (): void {
    $names = array_map(fn (Route $r) => $r->getName(), apiRoutes());

    expect(array_diff(array_keys(EXEMPT_ROUTES), $names))->toBe([]);
});

it('constrains every id in an authorized route to a UUID, so bad ids are 404s and not SQL errors', function (): void {
    $loose = collect(apiRoutes())
        ->reject(fn (Route $r) => isFortify($r) || array_key_exists((string) $r->getName(), EXEMPT_ROUTES))
        ->flatMap(fn (Route $r) => collect($r->parameterNames())
            ->reject(fn (string $p) => $p === 'company') // ResolveCompany checks it
            ->reject(fn (string $p) => isset($r->wheres[$p]))
            ->map(fn (string $p) => $r->uri().' {'.$p.'}'))
        ->values()->all();

    expect($loose)->toBe([]);
});

it('resolves tenant, company and the idempotency claim before route-model binding and policies', function (): void {
    Router::middleware(['api', 'auth:sanctum', 'tenant', 'tenant.writable', 'idempotent', 'company'])
        ->post('api/v1/_order/companies/{company}/things/{thing}', fn () => null)->name('test.order')
        ->can('update', 'thing');
    Router::getRoutes()->refreshNameLookups();
    $route = Router::getRoutes()->getByName('test.order');
    $stack = array_map(
        fn (string $m) => explode(':', $m, 2)[0],
        app('router')->gatherRouteMiddleware($route),
    );
    $at = fn (string $class) => array_search($class, $stack, true);

    expect($at(ResolveTenant::class))->toBeLessThan($at(ResolveCompany::class))
        ->and($at(ResolveCompany::class))->toBeLessThan($at(RequireIdempotencyKey::class))
        ->and($at(RequireIdempotencyKey::class))->toBeLessThan($at(SubstituteBindings::class))
        ->and($at(SubstituteBindings::class))->toBeLessThan($at(Illuminate\Auth\Middleware\Authorize::class));
});
