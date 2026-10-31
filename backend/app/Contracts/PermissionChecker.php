<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Support\Actor;

/**
 * Company-scoped permission lookup used by Actions for defence-in-depth checks (13 §7).
 * Backed by spatie/permission from plan step 1.5; until then the default denies everything.
 */
interface PermissionChecker
{
    public function allows(Actor $actor, string $permission, string $companyId): bool;
}
