<?php

declare(strict_types=1);

namespace App\Policies\Organisation;

use App\Models\Organisation\Invitation;
use App\Models\Platform\User;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Org owners and admins manage invitations. Which org roles an admin may grant is the Action's rule
 * (`InviteMember`), checked again there.
 */
final class InvitationPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $user): bool
    {
        return $user instanceof User && $this->context->isOrgAdmin($user);
    }

    public function create(Authenticatable $user): bool
    {
        return $user instanceof User && $this->context->isOrgAdmin($user);
    }

    public function delete(Authenticatable $user, Invitation $invitation): bool
    {
        return $user instanceof User && $this->context->isOrgAdmin($user) && $invitation->accepted_at === null;
    }
}
