<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Contracts\IdGenerator;
use App\Domain\Organisation\PermissionMatrix;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Permission;
use App\Models\Organisation\Role;
use App\Models\Platform\TenantUser;
use App\Queries\Organisation\HeldPermissions;
use App\Support\Actor;
use App\Support\ActorType;
use Spatie\Permission\PermissionRegistrar;

/**
 * The rules every role-editing Action shares (plan 3c.25): who may edit, which permission names exist, what a person may hand out, and
 * how a role's permission set is written. Role permissions are only ever *which doors a person may try*; maker ≠ checker, period state and
 * the ledger rules are checked by the Policies and Actions at the moment of the act and are not touched here.
 */
final class CompanyRoleRules
{
    public const string GUARD = 'web';

    public function __construct(
        private readonly IdGenerator $ids,
        private readonly HeldPermissions $held,
        private readonly PermissionRegistrar $registrar,
    ) {}

    /** Only organisation owners and admins edit roles, the same people who assign them. */
    public function requireOrgAdmin(Actor $actor): void
    {
        $isAdmin = $actor->type === ActorType::User && $actor->id !== null
            && TenantUser::query()->where('tenant_id', $actor->tenantId)->where('user_id', $actor->id)
                ->where('status', 'active')->whereIn('role', ['owner', 'admin'])->exists();
        if (! $isAdmin) {
            throw DomainRuleViolation::single('forbidden', 'Only organisation owners and admins can manage company roles.');
        }
    }

    /**
     * A role is a set of names from the matrix and nothing else.
     *
     * @param  list<string>  $permissions
     * @return list<string> sorted, unique
     */
    public function known(array $permissions): array
    {
        $unique = array_values(array_unique($permissions));
        $unknown = array_values(array_diff($unique, PermissionMatrix::permissions()));
        if ($unknown !== []) {
            throw DomainRuleViolation::single('permission_unknown', 'Unknown permission: '.implode(', ', $unknown).'.');
        }
        sort($unique);

        return $unique;
    }

    /**
     * A person cannot hand out a right they do not hold themselves in this company. Only the permissions being *added* to the role count.
     *
     * @param  list<string>  $added
     */
    public function requireHolds(Actor $actor, string $companyId, array $added): void
    {
        if ($added === []) {
            return;
        }
        $mine = $actor->id === null ? [] : ($this->held)($actor->id, $companyId);
        $missing = array_values(array_diff($added, $mine));
        if ($missing !== []) {
            throw DomainRuleViolation::single(
                'permission_above_own',
                'You cannot give a role rights you do not hold yourself in this company: '.implode(', ', $missing).'.',
            );
        }
    }

    public function find(string $companyId, string $roleId): Role
    {
        return Role::query()->where('company_id', $companyId)->where('guard_name', self::GUARD)->whereKey($roleId)->lockForUpdate()->firstOrFail();
    }

    public function isOwner(Role $role): bool
    {
        return $role->is_system && $role->name === PermissionMatrix::OWNER;
    }

    /** @return list<string> the role's permission names, sorted */
    public function namesOf(Role $role): array
    {
        /** @var list<string> $names */
        $names = $role->permissions()->orderBy('name')->pluck('name')->all();

        return $names;
    }

    /**
     * Writes exactly this set of (already validated) names to the role, creating tenant permission rows that do not exist yet.
     *
     * @param  list<string>  $names
     */
    public function write(Actor $actor, Role $role, array $names): void
    {
        /** @var array<string, string> $ids name → id */
        $ids = Permission::query()->where('guard_name', self::GUARD)->pluck('id', 'name')->all();
        $wanted = [];
        foreach ($names as $name) {
            if (! isset($ids[$name])) {
                $permission = new Permission;
                $permission->forceFill(['id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'name' => $name, 'guard_name' => self::GUARD])->save();
                $ids[$name] = $permission->id;
            }
            $wanted[] = $ids[$name];
        }
        $role->permissions()->sync($wanted);
    }

    /**
     * True when the set differs from what the matrix gives that seeded role.
     *
     * @param  list<string>  $names
     */
    public function differsFromDefault(Role $role, array $names): bool
    {
        $default = PermissionMatrix::forRole($role->name);
        sort($default);
        $sorted = $names;
        sort($sorted);

        return $default !== $sorted;
    }

    /** The registry is cached per tenant; drop it now and again once the commit is visible to other requests. */
    public function forgetCache(): void
    {
        $this->registrar->forgetCachedPermissions();
    }
}
