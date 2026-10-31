<?php

declare(strict_types=1);

namespace App\Support\Testing;

use App\Contracts\PermissionChecker;
use App\Support\Actor;

/** Test double: grants exactly the listed permissions to every actor. */
final class GrantedPermissions implements PermissionChecker
{
    /** @param list<string> $permissions */
    public function __construct(private array $permissions = []) {}

    public function allows(Actor $actor, string $permission, string $companyId): bool
    {
        return in_array($permission, $this->permissions, true);
    }
}
