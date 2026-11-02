<?php

declare(strict_types=1);

namespace App\Policies\Organisation;

use App\Contracts\CompanyAccess;
use App\Models\Organisation\ApiClient;
use App\Models\Organisation\Company;
use App\Models\Platform\User;
use App\Policies\PolicyContext;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Companies of the current organisation (13 §7). */
final class CompanyPolicy
{
    public function __construct(
        private readonly PolicyContext $context,
        private readonly CompanyAccess $access,
        private readonly TenantContext $tenant,
    ) {}

    /** Any active member lists the companies; the list itself is filtered to those they can open. */
    public function viewAny(Authenticatable $user): bool
    {
        // A token may list the companies it was issued for; the list is filtered to those.
        return $user instanceof ApiClient || ($user instanceof User && $this->context->orgRole($user) !== null);
    }

    public function view(Authenticatable $user, Company $company): bool
    {
        $tenantId = $this->tenant->id();

        return $tenantId !== null && $this->access->allows($user, $tenantId, $company->id);
    }

    public function create(Authenticatable $user): bool
    {
        return $user instanceof User && $this->context->isOrgAdmin($user);
    }

    /** Company settings (numbering, posting accounts, workflows, thresholds). */
    public function update(Authenticatable $user, Company $company): bool
    {
        return $user instanceof User && $this->context->allows($user, 'settings.manage', $company->id);
    }

    /** Reading the settings screen: people with `settings.view`. */
    public function viewSettings(Authenticatable $user, Company $company): bool
    {
        return $user instanceof User && $this->context->allows($user, 'settings.view', $company->id);
    }

    /** Assigning and revoking company roles: organisation owners and admins (the Actions check again). */
    public function manageRoles(Authenticatable $user, Company $company): bool
    {
        return $user instanceof User && $this->context->isOrgAdmin($user);
    }
}
