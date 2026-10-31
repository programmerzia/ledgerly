<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\Platform\Tenant;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * 13 §5 step 6: tenants in `read_only` or `suspended` lifecycle (and read-only impersonation, 4b.6)
 * may read but not change anything. Mutating methods get 423 `tenant_read_only`.
 */
final class EnsureTenantWritable
{
    private const array READ_ONLY_LIFECYCLES = ['read_only', 'suspended'];

    public function handle(Request $request, Closure $next): Response
    {
        $tenant = $request->attributes->get('tenant');

        if (! $request->isMethodSafe() && $tenant instanceof Tenant
            && (in_array($tenant->lifecycle, self::READ_ONLY_LIFECYCLES, true) || $request->attributes->get('impersonation_read_only') === true)) {
            throw DomainRuleViolation::single('tenant_read_only', 'This organisation is read-only. Changes are not allowed right now.');
        }

        /** @var Response */
        return $next($request);
    }
}
