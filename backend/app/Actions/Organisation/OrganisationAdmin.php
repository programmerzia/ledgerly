<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\Platform\TenantUser;
use App\Support\Actor;
use App\Support\ActorType;

/** Org-level guard shared by membership Actions: the actor's active role in the tenant. */
final class OrganisationAdmin
{
    /** @return 'owner'|'admin' */
    public static function require(Actor $actor, string $message): string
    {
        $role = $actor->type === ActorType::User && $actor->id !== null
            ? TenantUser::query()->where('tenant_id', $actor->tenantId)->where('user_id', $actor->id)
                ->where('status', 'active')->value('role')
            : null;
        if ($role !== 'owner' && $role !== 'admin') {
            throw DomainRuleViolation::single('forbidden', $message);
        }

        return $role;
    }
}
