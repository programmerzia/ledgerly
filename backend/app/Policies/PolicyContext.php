<?php

declare(strict_types=1);

namespace App\Policies;

use App\Contracts\PermissionChecker;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\CompanyContext;
use App\Support\Tenancy\OrganisationRole;
use App\Support\Tenancy\TenantContext;

/**
 * What every Policy needs (13 §7): the request's tenant and company and the user's rights in them.
 * Fails closed: no tenant, or no company for a company permission, denies.
 */
final class PolicyContext
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CompanyContext $company,
        private readonly PermissionChecker $permissions,
    ) {}

    public function orgRole(User $user): ?string
    {
        $tenantId = $this->tenant->id();

        return $tenantId === null ? null : OrganisationRole::of($tenantId, $user->id);
    }

    public function isOrgAdmin(User $user): bool
    {
        return OrganisationRole::isAdmin($this->orgRole($user));
    }

    /** A company permission in $companyId, or the request's company when null. */
    public function allows(User $user, string $permission, ?string $companyId = null): bool
    {
        $tenantId = $this->tenant->id();
        $companyId ??= $this->company->id();
        if ($tenantId === null || $companyId === null) {
            return false;
        }

        return $this->permissions->allows(new Actor(ActorType::User, $user->id, $tenantId, $companyId), $permission, $companyId);
    }
}
