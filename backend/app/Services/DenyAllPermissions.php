<?php

declare(strict_types=1);

namespace App\Services;

use App\Contracts\PermissionChecker;
use App\Support\Actor;

/** Fail-closed placeholder until spatie/permission is wired (plan step 1.5). */
final class DenyAllPermissions implements PermissionChecker
{
    public function allows(Actor $actor, string $permission, string $companyId): bool
    {
        return false;
    }
}
