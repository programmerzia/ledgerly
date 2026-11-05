<?php

declare(strict_types=1);

namespace App\Services\Notifications;

use App\Models\Platform\User;
use Illuminate\Support\Facades\DB;

/** The people who hold a company role (spatie, team = company). Runs inside the tenant context, so RLS applies. */
final class RoleHolders
{
    /** @return list<string> user ids */
    public function of(string $companyId, string $roleName): array
    {
        return array_values(array_map('strval', DB::table('model_has_roles as m')
            ->join('roles as r', 'r.id', '=', 'm.role_id')
            ->where('m.company_id', $companyId)->where('r.name', $roleName)->where('r.guard_name', 'web')
            ->where('m.model_type', (new User)->getMorphClass())
            ->orderBy('m.model_id')->pluck('m.model_id')->all()));
    }
}
