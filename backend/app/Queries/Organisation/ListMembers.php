<?php

declare(strict_types=1);

namespace App\Queries\Organisation;

use App\Models\Organisation\Company;
use App\Models\Platform\TenantUser;
use App\Models\Platform\User;
use App\Support\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * The organisation's people with their org role and, per company, their company roles. An organisation holds a bounded
 * number of seats (plan limits, 4b.2), so the list is not paged; it is capped at LIMIT as a guard.
 */
final class ListMembers
{
    public const int LIMIT = 500;

    public function __construct(private readonly TenantContext $tenant) {}

    /** @return list<TenantUser> each with name, email and `company_roles` (company id → role names) */
    public function __invoke(?string $status = null): array
    {
        $tenantId = $this->tenant->require();
        $members = TenantUser::query()->join('users', 'users.id', '=', 'tenant_users.user_id')
            ->where('tenant_users.tenant_id', $tenantId)
            ->when($status !== null, fn ($q) => $q->where('tenant_users.status', $status))
            ->orderBy('users.name')->orderBy('users.id')->limit(self::LIMIT)
            ->get(['tenant_users.*', 'users.name', 'users.email']);

        /** @var array<string, array<string, list<string>>> $roles user → company → names */
        $roles = [];
        $rows = DB::table('model_has_roles as m')->join('roles as r', 'r.id', '=', 'm.role_id')
            ->where('m.model_type', (new User)->getMorphClass())->whereIn('m.model_id', $members->pluck('user_id')->all())
            ->orderBy('r.name')->get(['m.model_id', 'm.company_id', 'r.name']);
        foreach ($rows as $row) {
            $roles[(string) $row->model_id][(string) $row->company_id][] = (string) $row->name;
        }
        $companies = Company::query()->pluck('id')->all();

        return array_values($members->map(function (TenantUser $m) use ($roles, $companies): TenantUser {
            $own = $roles[(string) $m->user_id] ?? [];
            $m->setAttribute('company_roles', (object) array_intersect_key($own, array_flip($companies)));

            return $m;
        })->all());
    }
}
