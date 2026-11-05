<?php

declare(strict_types=1);

namespace App\Queries\Organisation;

use Illuminate\Support\Facades\DB;

/** How many people hold one role in a company. Runs under the request's tenant. */
final class RoleHolderCount
{
    public function __invoke(string $companyId, string $roleId): int
    {
        return DB::table('model_has_roles')->where('company_id', $companyId)->where('role_id', $roleId)->count();
    }
}
