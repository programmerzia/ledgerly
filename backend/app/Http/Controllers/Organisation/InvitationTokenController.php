<?php

declare(strict_types=1);

namespace App\Http\Controllers\Organisation;

use App\Actions\Organisation\AcceptInvitation;
use App\Actions\Organisation\Inputs\AcceptInvitationInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Auth\PasswordRules;
use App\Http\Controllers\Controller;
use App\Http\Middleware\AssignRequestId;
use App\Http\Middleware\ResolveTenant;
use App\Models\Organisation\Invitation;
use App\Models\Platform\Tenant;
use App\Models\Platform\User;
use App\Queries\Organisation\FindInvitationByToken;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;

/**
 * The invitation link (02_AppFlow §2 `/invitations/{token}`), before any tenant is chosen: preview
 * what it is for, then accept as the signed-in user or by creating the invited account.
 */
final class InvitationTokenController extends Controller
{
    public function __construct(private readonly FindInvitationByToken $find, private readonly TenantContext $tenant) {}

    public function show(string $token, Clock $clock): JsonResponse
    {
        [$tenant, $invitation] = $this->resolve($token);

        $status = 'open';
        try {
            AcceptInvitation::assertOpen($invitation, $clock->now());
        } catch (DomainRuleViolation $e) {
            $status = match ($e->errorCode) {
                'invitation_already_accepted' => 'accepted',
                'invitation_revoked' => 'revoked',
                default => 'expired',
            };
        }

        return response()->json(['data' => [
            'organisation' => $tenant->name,
            'email' => $invitation->email,
            'role' => $invitation->role,
            'company_role' => $invitation->company_role,
            'status' => $status,
            'expires_at' => $invitation->expires_at->toIso8601String(),
            // The SPA asks for a password (new account) or a sign-in (existing account).
            'account_exists' => User::query()->whereRaw('lower(email) = ?', [mb_strtolower($invitation->email)])->exists(),
        ]]);
    }

    public function accept(Request $request, string $token, AcceptInvitation $action, IdGenerator $ids): JsonResponse
    {
        [$tenant, $invitation] = $this->resolve($token);

        $signedIn = Auth::guard('web')->user();
        if ($signedIn instanceof User) {
            $userId = $signedIn->id;
            $input = new AcceptInvitationInput($invitation->id, $token);
        } else {
            $data = $request->validate([
                'name' => ['required', 'string', 'max:255'],
                'password' => PasswordRules::rules(),
            ]);
            $userId = $ids->next();
            $input = new AcceptInvitationInput($invitation->id, $token, (string) $data['name'], Hash::make((string) $data['password']));
        }

        $actor = new Actor(
            ActorType::User, $userId, $tenant->id,
            ip: $request->ip(), userAgent: $request->userAgent(), requestId: $request->headers->get(AssignRequestId::HEADER),
        );
        $this->tenant->run($tenant->id, fn () => $action->handle($actor, $input));

        if (! $signedIn instanceof User) {
            Auth::guard('web')->login(User::query()->findOrFail($userId));
        }
        $request->session()->regenerate();
        $request->session()->put(ResolveTenant::SESSION_KEY, $tenant->id);

        return response()->json(['data' => ['tenant_id' => $tenant->id, 'organisation' => $tenant->name]]);
    }

    /** @return array{Tenant, Invitation} */
    private function resolve(string $token): array
    {
        $found = ($this->find)($token);
        $tenant = $found === null ? null : Tenant::query()->find($found['tenant_id']);
        if ($found === null || $tenant === null) {
            throw DomainRuleViolation::single('invitation_not_found', 'This invitation link is not valid.');
        }
        if (in_array($tenant->lifecycle, ResolveTenant::CLOSED_LIFECYCLES, true)) {
            throw DomainRuleViolation::single('tenant_unavailable', 'This organisation is no longer available.');
        }
        $invitation = $this->tenant->run($tenant->id, fn () => Invitation::query()->findOrFail($found['invitation_id']));

        return [$tenant, $invitation];
    }
}
