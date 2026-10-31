<?php

declare(strict_types=1);

namespace App\Services\Tenancy;

use App\Contracts\CompanyAccess;
use App\Models\Organisation\ApiClient;
use App\Models\Platform\TenantUser;
use App\Models\Platform\User;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\DB;

/**
 * Org owners/admins reach every company of the tenant; plain active members reach the companies
 * where they hold any role; API clients reach their `company_ids` (13 §7).
 */
final class SpatieCompanyAccess implements CompanyAccess
{
    public function allows(Authenticatable $principal, string $tenantId, string $companyId): bool
    {
        if ($principal instanceof ApiClient) {
            return $principal->tenant_id === $tenantId
                && $principal->revoked_at === null
                && in_array($companyId, $principal->company_ids, true);
        }

        if (! $principal instanceof User) {
            return false;
        }

        $membership = TenantUser::query()
            ->where('tenant_id', $tenantId)->where('user_id', $principal->id)->where('status', 'active')
            ->first();
        if ($membership === null) {
            return false;
        }
        if (in_array($membership->role, ['owner', 'admin'], true)) {
            return true;
        }

        return DB::table((string) config('permission.table_names.model_has_roles'))
            ->where('tenant_id', $tenantId)
            ->where('company_id', $companyId)
            ->where('model_type', $principal->getMorphClass())
            ->where('model_id', $principal->id)
            ->exists();
    }
}
