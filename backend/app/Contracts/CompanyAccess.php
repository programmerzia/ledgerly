<?php

declare(strict_types=1);

namespace App\Contracts;

use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Whether a principal (user or API client) may work in a company of the current tenant (13 §7).
 * Org owners and admins reach every company; members reach the companies they hold a role in
 * (spatie roles with team = company, plan step 1.5); API clients reach their `company_ids`.
 */
interface CompanyAccess
{
    public function allows(Authenticatable $principal, string $tenantId, string $companyId): bool;
}
