<?php

declare(strict_types=1);

namespace App\Queries\Organisation;

use App\Models\Platform\User;
use Illuminate\Support\Facades\DB;

/** The company permissions a person holds through their roles in one company (the same source spatie answers from). Runs under the request's tenant. */
final class HeldPermissions
{
    /** @return list<string> sorted, unique */
    public function __invoke(string $userId, string $companyId): array
    {
        /** @var list<string> */
        return DB::table('model_has_roles as m')
            ->join('role_has_permissions as rp', 'rp.role_id', '=', 'm.role_id')
            ->join('permissions as p', 'p.id', '=', 'rp.permission_id')
            ->where('m.model_type', (new User)->getMorphClass())->where('m.model_id', $userId)->where('m.company_id', $companyId)
            ->distinct()->orderBy('p.name')->pluck('p.name')->all();
    }
}
