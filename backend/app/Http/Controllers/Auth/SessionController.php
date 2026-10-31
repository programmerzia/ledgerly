<?php

declare(strict_types=1);

namespace App\Http\Controllers\Auth;

use App\Domain\Shared\DomainRuleViolation;
use App\Http\Controllers\Controller;
use App\Http\Middleware\ResolveTenant;
use App\Models\Platform\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * The signed-in user and their organisations (13 §7). Works before a tenant is chosen, so it reads
 * only platform tables and never the tenant context.
 */
final class SessionController extends Controller
{
    public function me(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $current = $request->session()->get(ResolveTenant::SESSION_KEY);

        $tenants = DB::table('tenant_users')
            ->join('tenants', 'tenants.id', '=', 'tenant_users.tenant_id')
            ->where('tenant_users.user_id', $user->id)
            ->where('tenant_users.status', 'active')
            ->whereNotIn('tenants.lifecycle', ['cancelled', 'deleted'])
            ->orderBy('tenants.name')
            ->get(['tenants.id', 'tenants.name', 'tenants.slug', 'tenants.lifecycle', 'tenant_users.role'])
            ->map(fn (object $t): array => [
                'id' => $t->id, 'name' => $t->name, 'slug' => $t->slug,
                'lifecycle' => $t->lifecycle, 'role' => $t->role, 'current' => $t->id === $current,
            ])->all();

        return new JsonResponse(['data' => [
            'id' => $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'two_factor_enabled' => $user->two_factor_confirmed_at !== null,
            'signing_pin_set' => $user->signing_pin_hash !== null,
            'tenants' => $tenants,
        ]]);
    }

    /** Switch the active organisation; regenerates the session id (fixation defence). */
    public function switchTenant(Request $request): JsonResponse
    {
        $user = $this->user($request);
        $tenantId = $request->validate(['tenant_id' => ['required', 'uuid']])['tenant_id'];

        $allowed = DB::table('tenant_users')
            ->join('tenants', 'tenants.id', '=', 'tenant_users.tenant_id')
            ->where('tenant_users.tenant_id', $tenantId)
            ->where('tenant_users.user_id', $user->id)
            ->where('tenant_users.status', 'active')
            ->whereNotIn('tenants.lifecycle', ['cancelled', 'deleted'])
            ->exists();
        if (! $allowed) {
            throw DomainRuleViolation::single('tenant_access_denied', 'You do not have access to this organisation.');
        }

        $request->session()->regenerate();
        $request->session()->put(ResolveTenant::SESSION_KEY, $tenantId);

        return $this->me($request);
    }

    private function user(Request $request): User
    {
        $user = $request->user();

        return $user instanceof User ? $user : throw DomainRuleViolation::single('unauthenticated', 'Sign in to continue.');
    }
}
