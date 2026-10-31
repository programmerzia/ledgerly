<?php

use App\Domain\Shared\DomainRuleViolation;
use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\EnsureTenantWritable;
use App\Http\Middleware\RequireIdempotencyKey;
use App\Http\Middleware\ResolveCompany;
use App\Http\Middleware\ResolveTenant;
use App\Http\Middleware\SetTenantFromToken;
use App\Support\Problem\ProblemRenderer;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Contracts\Auth\Middleware\AuthenticatesRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;
use Illuminate\Routing\Middleware\SubstituteBindings;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

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
        // Route-model binding reads RLS tables, so tenant and company resolve first; the idempotency
        // claim needs the tenant and must precede Authorize, which sorts after SubstituteBindings.
        // Only prepends anchored on SubstituteBindings: Laravel applies appends before prepends, so an
        // "append after ResolveTenant" would find no anchor and fall to the end. Each prepend lands
        // directly before SubstituteBindings, so declaration order is the resulting order.
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: ResolveTenant::class);
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: ResolveCompany::class);
        $middleware->prependToPriorityList(before: SubstituteBindings::class, prepend: RequireIdempotencyKey::class);
        $middleware->alias([
            'tenant' => ResolveTenant::class,
            'company' => ResolveCompany::class,
            'tenant.writable' => EnsureTenantWritable::class,
            'idempotent' => RequireIdempotencyKey::class,
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
        $exceptions->render(fn (DomainRuleViolation $e, Request $request) => ProblemRenderer::domain($e, $request));
        $exceptions->render(fn (ValidationException $e, Request $request) => $request->is('api/*')
            ? ProblemRenderer::validation($e, $request) : null);
        // Policies throw AuthorizationException; the handler hands callbacks its HTTP form.
        $exceptions->render(fn (AccessDeniedHttpException $e, Request $request) => $request->is('api/*')
            ? ProblemRenderer::http('forbidden', 'You do not have permission to do this.', $request) : null);
        $exceptions->render(fn (AuthenticationException $e, Request $request) => $request->is('api/*')
            ? ProblemRenderer::http('unauthenticated', 'Sign in to continue.', $request) : null);
        // Unknown ids, including rows another tenant owns (RLS hides them): never say which.
        $exceptions->render(fn (NotFoundHttpException $e, Request $request) => $request->is('api/*')
            ? ProblemRenderer::http('not_found', 'The resource does not exist.', $request) : null);
    })->create();
