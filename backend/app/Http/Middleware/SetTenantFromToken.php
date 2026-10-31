<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Runs before `auth:sanctum`. API clients are RLS-protected, so Sanctum can only load the token's
 * ApiClient once the tenant context is set. The token row (platform table) carries `tenant_id`;
 * this sets the context from it. The token is not trusted here: Sanctum verifies the secret next,
 * and `ResolveTenant` re-checks that the authenticated client belongs to this tenant. A wrong or
 * unknown token leaves no context (the request then fails authentication and sees no rows).
 */
final class SetTenantFromToken
{
    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();
        $set = false;

        if (is_string($token) && str_contains($token, '|')) {
            [$id] = explode('|', $token, 2);
            if (ctype_digit($id)) {
                $tenantId = DB::table('personal_access_tokens')->where('id', (int) $id)->value('tenant_id');
                if (is_string($tenantId)) {
                    $this->context->set($tenantId);
                    $set = true;
                }
            }
        }

        try {
            /** @var Response */
            return $next($request);
        } finally {
            // Also covers a failed authentication, where ResolveTenant never runs.
            if ($set) {
                $this->context->clear();
            }
        }
    }
}
