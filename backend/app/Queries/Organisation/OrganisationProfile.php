<?php

declare(strict_types=1);

namespace App\Queries\Organisation;

use App\Contracts\CompanyAccess;
use App\Models\Organisation\Company;
use App\Models\Platform\Tenant;
use App\Models\Platform\TenantUser;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** The organisation page's data (plan 3c.26): who it is, how many people, and the companies the person can open. */
final class OrganisationProfile
{
    public function __construct(private readonly TenantContext $tenant, private readonly CompanyAccess $access) {}

    /** @return array<string, mixed> */
    public function __invoke(Authenticatable $principal): array
    {
        $tenantId = $this->tenant->require();
        $tenant = Tenant::query()->findOrFail($tenantId);
        $companies = Company::query()->orderBy('name')->get()
            ->filter(fn (Company $c): bool => $this->access->allows($principal, $tenantId, $c->id))
            ->map(fn (Company $c): array => [
                'id' => $c->id, 'name' => $c->name, 'legal_name' => $c->legal_name, 'slug' => $c->slug, 'country' => $c->country,
                'base_currency' => $c->base_currency, 'status' => $c->status,
            ])->values()->all();

        return [
            'id' => $tenant->id,
            'name' => $tenant->name,
            'slug' => $tenant->slug,
            'created_at' => $tenant->created_at?->toIso8601String(),
            'members' => TenantUser::query()->where('tenant_id', $tenantId)->where('status', 'active')->count(),
            'companies' => $companies,
        ];
    }
}
