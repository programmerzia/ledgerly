<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Contracts\RoleChecker;
use App\Support\Actor;

/** Test double: every person holds every role, so a race test can focus on locking, not on role setup. */
final class AllowAllRoles implements RoleChecker
{
    public function holds(Actor $actor, string $roleName, string $companyId): bool
    {
        return true;
    }
}
