<?php

declare(strict_types=1);

namespace App\Services\Tenancy;

use App\Contracts\CompanyAccess;
use App\Models\Organisation\ApiClient;
use App\Models\Platform\User;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\DB;

/**
 * Company access before per-company roles exist (plan step 1.5 adds them): owners and admins of the
 * tenant reach every company, members reach none (fail closed), API clients reach their
 * `company_ids`.
 */
final class OrgRoleCompanyAccess implements CompanyAccess
{
    public function allows(Authenticatable $principal, string $tenantId, string $companyId): bool
    {
        if ($principal instanceof ApiClient) {
            return $principal->tenant_id === $tenantId
                && $principal->revoked_at === null
                && in_array($companyId, $principal->company_ids, true);
        }

        if ($principal instanceof User) {
            return DB::table('tenant_users')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $principal->id)
                ->where('status', 'active')
                ->whereIn('role', ['owner', 'admin'])
                ->exists();
        }

        return false;
    }
}
