<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Organisation\Inputs\InviteMemberInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Organisation\PermissionMatrix;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use App\Models\Organisation\Invitation;
use App\Models\Platform\Tenant;
use App\Models\Platform\TenantUser;
use App\Models\Platform\User;
use App\Notifications\InvitationNotification;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;

/**
 * Invites someone to the organisation (02_AppFlow §2, §3 step 5). Owners invite any org role,
 * admins invite members only. Members must get a company role, or they could open nothing.
 * Re-inviting an email replaces its open invitation. Only the token's hash is stored; the raw
 * token goes out by email after commit.
 */
final class InviteMember
{
    public const int VALID_DAYS = 7;

    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, InviteMemberInput $in): Invitation
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $actorRole = OrganisationAdmin::require($actor, 'Only organisation owners and admins can invite people.');
            if ($in->role !== 'member' && $actorRole !== 'owner') {
                throw DomainRuleViolation::single('forbidden', 'Only organisation owners can invite owners or admins.');
            }
            $this->checkCompanyRole($in);

            $email = mb_strtolower($in->email);
            $userId = User::query()->whereRaw('lower(email) = ?', [$email])->value('id');
            if ($userId !== null && TenantUser::query()->where('tenant_id', $actor->tenantId)->where('user_id', $userId)->exists()) {
                throw DomainRuleViolation::single('already_member', 'This person is already in the organisation.');
            }

            $now = $this->clock->now();
            $replaced = Invitation::query()->whereRaw('lower(email) = ?', [$email])
                ->whereNull('accepted_at')->whereNull('revoked_at')->get();
            foreach ($replaced as $old) {
                $old->forceFill(['revoked_at' => $now])->save();
                $audit->add('invitation.revoked', $old, context: ['reason' => 'replaced']);
            }

            $token = Str::random(48);
            $invitation = new Invitation;
            $invitation->forceFill([
                'id' => $this->ids->next(),
                'tenant_id' => $actor->tenantId,
                'email' => $email,
                'role' => $in->role,
                'company_role' => $in->companyRole,
                'company_ids' => $in->companyIds === [] ? null : array_values(array_unique($in->companyIds)),
                'invited_by' => $actor->id,
                'token_hash' => hash('sha256', $token),
                'expires_at' => $now->modify('+'.self::VALID_DAYS.' days'),
            ])->save();

            $audit->add('invitation.created', $invitation, after: [
                'email' => $email, 'role' => $in->role, 'company_role' => $in->companyRole, 'company_ids' => $invitation->company_ids,
            ]);

            $organisation = (string) Tenant::query()->whereKey($actor->tenantId)->value('name');
            $inviter = (string) User::query()->whereKey($actor->id)->value('name');
            $this->uow->afterCommit(fn () => Notification::route('mail', $email)
                ->notify(new InvitationNotification($token, $organisation, $inviter)));

            return $invitation;
        });
    }

    private function checkCompanyRole(InviteMemberInput $in): void
    {
        if ($in->companyRole === null) {
            if ($in->role === 'member' || $in->companyIds !== []) {
                throw DomainRuleViolation::single('company_role_required', 'Choose a company role and at least one company for a member.');
            }

            return;
        }
        if (! in_array($in->companyRole, PermissionMatrix::ROLES, true)) {
            throw DomainRuleViolation::single('role_not_found', "There is no company role named {$in->companyRole}.");
        }
        $ids = array_values(array_unique($in->companyIds));
        if ($ids === [] || Company::query()->whereIn('id', $ids)->where('status', 'active')->count() !== count($ids)) {
            throw DomainRuleViolation::single('company_not_found', 'Choose at least one active company of this organisation.');
        }
    }
}
