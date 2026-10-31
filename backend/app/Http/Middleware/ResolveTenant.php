<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\ApiClient;
use App\Models\Platform\Tenant;
use App\Models\Platform\User;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * 13 §5 steps 3–4 and 10: decide the tenant, check the principal may work in it, set the context on
 * every tenant connection, and clear it when the request ends.
 *
 * - SPA users: `current_tenant_id` from the session (`PUT /session/tenant` switches it). A user with
 *   exactly one active membership gets it selected automatically.
 * - API clients: the token's tenant (`SetTenantFromToken`), re-checked against the loaded client.
 * The resolved tenant is shared as the `tenant` request attribute.
 */
final class ResolveTenant
{
    public const string SESSION_KEY = 'current_tenant_id';

    /** Lifecycles in which nobody may open the books (read-only and suspended still read). */
    private const array CLOSED_LIFECYCLES = ['cancelled', 'deleted'];

    public function __construct(private readonly TenantContext $context) {}

    public function handle(Request $request, Closure $next): Response
    {
        // Sanctum resolves either a session user or a token's ApiClient; don't assume the user model.
        $principal = call_user_func($request->getUserResolver());
        $tenantId = match (true) {
            $principal instanceof ApiClient => $this->forApiClient($principal),
            $principal instanceof User => $this->forUser($principal, $request),
            default => throw DomainRuleViolation::single('unauthenticated', 'Sign in to continue.'),
        };

        $tenant = Tenant::query()->find($tenantId);
        if ($tenant === null || in_array($tenant->lifecycle, self::CLOSED_LIFECYCLES, true)) {
            throw DomainRuleViolation::single('tenant_unavailable', 'This organisation is no longer available.');
        }

        if ($principal instanceof User && ($tenant->settings['require_two_factor'] ?? false) === true
            && $principal->two_factor_confirmed_at === null) {
            throw DomainRuleViolation::single('two_factor_required', 'This organisation requires two-factor authentication. Set it up to continue.');
        }

        $this->context->set($tenant->id);
        $request->attributes->set('tenant', $tenant);

        try {
            /** @var Response */
            return $next($request);
        } finally {
            $this->context->clear();
        }
    }

    private function forApiClient(ApiClient $client): string
    {
        // The client was loaded under the token's tenant; a mismatch means a forged pairing.
        if ($client->revoked_at !== null || $this->context->id() !== $client->tenant_id) {
            throw DomainRuleViolation::single('unauthenticated', 'This API client is not valid.');
        }

        return $client->tenant_id;
    }

    private function forUser(User $user, Request $request): string
    {
        $session = $request->hasSession() ? $request->session() : null;
        $selected = $session === null ? null : $session->get(self::SESSION_KEY);

        $memberships = DB::table('tenant_users')
            ->where('user_id', $user->id)
            ->where('status', 'active')
            ->pluck('tenant_id')
            ->all();

        if (is_string($selected)) {
            if (! in_array($selected, $memberships, true)) {
                $session->forget(self::SESSION_KEY);
                throw DomainRuleViolation::single('tenant_access_denied', 'You no longer have access to this organisation.');
            }

            return $selected;
        }

        if (count($memberships) === 1) {
            $session?->put(self::SESSION_KEY, $memberships[0]);

            return $memberships[0];
        }

        throw DomainRuleViolation::single(
            'tenant_required',
            $memberships === [] ? 'You are not a member of any organisation.' : 'Choose an organisation to continue.',
        );
    }
}
