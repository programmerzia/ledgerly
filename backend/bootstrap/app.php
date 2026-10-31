<?php

use App\Domain\Shared\DomainRuleViolation;
use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\EnsureTenantWritable;
use App\Http\Middleware\ResolveCompany;
use App\Http\Middleware\ResolveTenant;
use App\Http\Middleware\SetTenantFromToken;
use App\Support\Problem\ProblemRenderer;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        api: __DIR__.'/../routes/api.php',
        apiPrefix: 'api/v1',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // 13 §5. Every API request gets a request id; bearer tokens set the tenant before
        // auth:sanctum loads the (RLS-protected) API client.
        // SPA requests from SANCTUM_STATEFUL_DOMAINS get session cookies and CSRF (13 §7).
        $middleware->statefulApi();
        $middleware->api(prepend: [AssignRequestId::class, SetTenantFromToken::class]);
        $middleware->prependToPriorityList(before: AuthenticatesRequests::class, prepend: SetTenantFromToken::class);
        $middleware->alias([
            'tenant' => ResolveTenant::class,
            'company' => ResolveCompany::class,
            'tenant.writable' => EnsureTenantWritable::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        $exceptions->render(fn (DomainRuleViolation $e, Request $request) => ProblemRenderer::domain($e, $request));
        $exceptions->render(fn (ValidationException $e, Request $request) => $request->is('api/*')
            ? ProblemRenderer::validation($e, $request) : null);
    })->create();
