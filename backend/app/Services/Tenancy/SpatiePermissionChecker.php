<?php

declare(strict_types=1);

namespace App\Services\Tenancy;

use App\Contracts\PermissionChecker;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use Spatie\Permission\Exceptions\PermissionDoesNotExist;
use Spatie\Permission\PermissionRegistrar;

/** Company-scoped check through spatie (team = company). API clients and system actors never pass. */
final class SpatiePermissionChecker implements PermissionChecker
{
    public function __construct(private readonly PermissionRegistrar $registrar) {}

    public function allows(Actor $actor, string $permission, string $companyId): bool
    {
        if (! in_array($actor->type, [ActorType::User, ActorType::AdminImpersonating], true) || $actor->id === null) {
            return false;
        }

        // Fresh model every time: spatie memoises roles on the instance, which would outlive a company/tenant switch.
        $user = User::query()->find($actor->id);
        if ($user === null) {
            return false;
        }

        $previous = $this->registrar->getPermissionsTeamId();
        $this->registrar->setPermissionsTeamId($companyId);

        try {
            return $user->hasPermissionTo($permission, 'web');
        } catch (PermissionDoesNotExist) {
            return false;
        } finally {
            $this->registrar->setPermissionsTeamId($previous);
        }
    }
}
