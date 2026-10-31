<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Domain\Shared\DomainRuleViolation;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\OrganisationRole;

/** Org-level guard shared by membership Actions: the actor's active role in the tenant. */
final class OrganisationAdmin
{
    /** @return 'owner'|'admin' */
    public static function require(Actor $actor, string $message): string
    {
        $role = $actor->type === ActorType::User && $actor->id !== null
            ? OrganisationRole::of($actor->tenantId, $actor->id)
            : null;
        if ($role !== 'owner' && $role !== 'admin') {
            throw DomainRuleViolation::single('forbidden', $message);
        }

        return $role;
    }
}
