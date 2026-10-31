<?php

declare(strict_types=1);

namespace App\Policies\Organisation;

use App\Contracts\CompanyAccess;
use App\Models\Organisation\Company;
use App\Models\Platform\User;
use App\Policies\PolicyContext;
use App\Support\Tenancy\TenantContext;

/** Companies of the current organisation (13 §7). */
final class CompanyPolicy
{
    public function __construct(
        private readonly PolicyContext $context,
        private readonly CompanyAccess $access,
        private readonly TenantContext $tenant,
    ) {}

    /** Any active member lists the companies; the list itself is filtered to those they can open. */
    public function viewAny(User $user): bool
    {
        return $this->context->orgRole($user) !== null;
    }

    public function view(User $user, Company $company): bool
    {
        $tenantId = $this->tenant->id();

        return $tenantId !== null && $this->access->allows($user, $tenantId, $company->id);
    }

    public function create(User $user): bool
    {
        return $this->context->isOrgAdmin($user);
    }

    /** Company settings (numbering, posting accounts, workflows, thresholds). */
    public function update(User $user, Company $company): bool
    {
        return $this->context->allows($user, 'settings.manage', $company->id);
    }
}
