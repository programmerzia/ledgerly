<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Support\Actor;

/** Does the actor hold a company role (13 §7)? Used by approval steps, which name roles, not permissions. */
interface RoleChecker
{
    public function holds(Actor $actor, string $roleName, string $companyId): bool;
}
