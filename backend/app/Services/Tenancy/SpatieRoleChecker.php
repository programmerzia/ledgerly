<?php

declare(strict_types=1);

namespace App\Services\Tenancy;

use App\Contracts\RoleChecker;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use Spatie\Permission\PermissionRegistrar;

/** Role membership through spatie (team = company). Only people hold roles. */
final class SpatieRoleChecker implements RoleChecker
{
    public function __construct(private readonly PermissionRegistrar $registrar) {}

    public function holds(Actor $actor, string $roleName, string $companyId): bool
    {
        if (! in_array($actor->type, [ActorType::User, ActorType::AdminImpersonating], true) || $actor->id === null) {
            return false;
        }
        $user = User::query()->find($actor->id);
        if ($user === null) {
            return false;
        }
        $previous = $this->registrar->getPermissionsTeamId();
        $this->registrar->setPermissionsTeamId($companyId);
        try {
            $user->unsetRelation('roles');

            return $user->hasRole($roleName, 'web');
        } finally {
            $this->registrar->setPermissionsTeamId($previous);
        }
    }
}
