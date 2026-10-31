<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Invitation;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Withdraws an open invitation; its link stops working at once. */
final class RevokeInvitation
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock) {}

    public function handle(Actor $actor, string $invitationId): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $invitationId) {
            OrganisationAdmin::require($actor, 'Only organisation owners and admins can withdraw invitations.');
            $invitation = Invitation::query()->whereKey($invitationId)->lockForUpdate()->first();
            if ($invitation === null) {
                throw DomainRuleViolation::single('invitation_not_found', 'The invitation does not exist.');
            }
            if ($invitation->accepted_at !== null) {
                throw DomainRuleViolation::single('invitation_already_accepted', 'The invitation has already been accepted.');
            }
            if ($invitation->revoked_at !== null) {
                return;
            }
            $invitation->forceFill(['revoked_at' => $this->clock->now()])->save();
            $audit->add('invitation.revoked', $invitation);
        });
    }
}
