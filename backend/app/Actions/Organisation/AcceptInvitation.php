<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Organisation\Inputs\AcceptInvitationInput;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Invitation;
use App\Models\Organisation\Role;
use App\Models\Platform\TenantUser;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;
use Spatie\Permission\PermissionRegistrar;

/**
 * Accepts an invitation as the actor (02_AppFlow §2). The actor is either the signed-in user whose
 * email the invitation names, or, with `createsUser()`, the account created here for that email.
 * Adds the membership and the invited company roles, then closes the invitation.
 */
final class AcceptInvitation
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly Clock $clock,
        private readonly PermissionRegistrar $registrar,
    ) {}

    public function handle(Actor $actor, AcceptInvitationInput $in): Invitation
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            if ($actor->type !== ActorType::User || $actor->id === null) {
                throw DomainRuleViolation::single('forbidden', 'Only a person can accept an invitation.');
            }

            // Row lock: two accepts of one link serialise, and the second sees accepted_at.
            $invitation = Invitation::query()->whereKey($in->invitationId)->lockForUpdate()->first();
            if ($invitation === null || ! hash_equals($invitation->token_hash, hash('sha256', $in->token))) {
                throw DomainRuleViolation::single('invitation_not_found', 'This invitation link is not valid.');
            }
            $now = $this->clock->now();
            self::assertOpen($invitation, $now);

            $user = $this->resolveUser($actor->id, $invitation, $in);

            $membership = TenantUser::query()->where('tenant_id', $actor->tenantId)->where('user_id', $user->id)->first();
            if ($membership !== null && $membership->status === 'disabled') {
                throw DomainRuleViolation::single('membership_disabled', 'Your access to this organisation has been disabled. Ask an owner to restore it.');
            }
            if ($membership === null) {
                (new TenantUser)->forceFill([
                    'tenant_id' => $actor->tenantId, 'user_id' => $user->id, 'role' => $invitation->role,
                    'status' => 'active', 'invited_by' => $invitation->invited_by, 'joined_at' => $now,
                ])->save();
            }

            $this->assignCompanyRoles($user, $invitation);

            $invitation->forceFill(['accepted_at' => $now])->save();
            $audit->add('invitation.accepted', $invitation, after: [
                'user_id' => $user->id, 'role' => $membership->role ?? $invitation->role,
                'company_role' => $invitation->company_role, 'company_ids' => $invitation->company_ids,
                'created_user' => $in->createsUser(),
            ]);

            return $invitation;
        });
    }

    /** Shared with the preview endpoint so both report the same state. */
    public static function assertOpen(Invitation $invitation, DateTimeImmutable $now): void
    {
        if ($invitation->accepted_at !== null) {
            throw DomainRuleViolation::single('invitation_already_accepted', 'This invitation has already been accepted. Sign in instead.');
        }
        if ($invitation->revoked_at !== null) {
            throw DomainRuleViolation::single('invitation_revoked', 'This invitation was withdrawn. Ask for a new one.');
        }
        if ($invitation->expires_at <= $now) {
            throw DomainRuleViolation::single('invitation_expired', 'This invitation has expired. Ask for a new one.');
        }
    }

    private function resolveUser(string $actorId, Invitation $invitation, AcceptInvitationInput $in): User
    {
        $existing = User::query()->whereRaw('lower(email) = ?', [mb_strtolower($invitation->email)])->first();

        if ($in->createsUser()) {
            if ($existing !== null) {
                throw DomainRuleViolation::single('sign_in_required', 'An account with this email already exists. Sign in to accept.');
            }
            $user = new User;
            $user->forceFill([
                'id' => $actorId, 'name' => (string) $in->newUserName, 'email' => mb_strtolower($invitation->email),
                'password' => $in->newUserPasswordHash, 'email_verified_at' => $this->clock->now(),
            ])->save();

            return $user;
        }

        if ($existing === null || $existing->id !== $actorId) {
            throw DomainRuleViolation::single('invitation_email_mismatch', 'This invitation was sent to a different email address.');
        }

        return $existing;
    }

    private function assignCompanyRoles(User $user, Invitation $invitation): void
    {
        if ($invitation->company_role === null) {
            return;
        }
        $previous = $this->registrar->getPermissionsTeamId();
        try {
            foreach ($invitation->company_ids ?? [] as $companyId) {
                $role = Role::query()->where('company_id', $companyId)->where('name', $invitation->company_role)
                    ->where('guard_name', 'web')->first();
                if ($role === null) {
                    continue; // the company was removed after the invitation went out
                }
                $this->registrar->setPermissionsTeamId($companyId);
                $user->unsetRelation('roles'); // spatie memoises roles of the previous team
                if (! $user->hasRole($role)) {
                    $user->assignRole($role);
                }
            }
        } finally {
            $this->registrar->setPermissionsTeamId($previous);
        }
    }
}
