<?php

declare(strict_types=1);

namespace App\Policies;

use App\Contracts\CompanyAccess;
use App\Contracts\PermissionChecker;
use App\Models\Organisation\ApiClient;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Tenancy\CompanyContext;
use App\Support\Tenancy\OrganisationRole;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * What every Policy needs (13 §7): the request's tenant and company and the principal's rights in them.
 * Fails closed: no tenant, or no company for a company permission, denies.
 *
 * Two kinds of principal: a person holds company permissions (`journals.approve`); an API client holds
 * token abilities (`journals:write`) and only inside the companies it was issued for. Anything that
 * approves, reverses, closes or signs asks for a person; reads and drafts may also accept a token.
 */
final class PolicyContext
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CompanyContext $company,
        private readonly PermissionChecker $permissions,
        private readonly CompanyAccess $access,
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

    /** A person with $permission, or an API client whose token carries $ability, in $companyId (default: the request's). */
    public function can(Authenticatable $principal, string $permission, string $ability, ?string $companyId = null): bool
    {
        return match (true) {
            $principal instanceof User => $this->allows($principal, $permission, $companyId),
            $principal instanceof ApiClient => $this->tokenCan($principal, $ability, $companyId),
            default => false,
        };
    }

    /** A person with $permission; tokens never pass. */
    public function personCan(Authenticatable $principal, string $permission, ?string $companyId = null): bool
    {
        return $principal instanceof User && $this->allows($principal, $permission, $companyId);
    }

    /** The token carries $ability and its client may work in the company (its `company_ids`). */
    private function tokenCan(ApiClient $client, string $ability, ?string $companyId): bool
    {
        $tenantId = $this->tenant->id();
        $companyId ??= $this->company->id();
        if ($tenantId === null || $companyId === null) {
            return false;
        }

        return $this->access->allows($client, $tenantId, $companyId) && $client->tokenCan($ability);
    }
}
