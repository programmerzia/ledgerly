<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Contracts\IdGenerator;
use App\Domain\Organisation\PermissionMatrix;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use App\Models\Organisation\Role;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Creates a custom role in one company (plan 3c.25). "Copy a role" is the same call with the other role's permissions filled in.
 * Organisation owners and admins only; the rights being given must be rights the person holds themselves.
 */
final class CreateCompanyRole
{
    public const int MAX_NAME = 64;

    public function __construct(private readonly UnitOfWork $uow, private readonly IdGenerator $ids, private readonly CompanyRoleRules $rules) {}

    /** @param list<string> $permissions */
    public function handle(Actor $actor, string $companyId, string $name, array $permissions): Role
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $name, $permissions) {
            $this->rules->requireOrgAdmin($actor);
            Company::query()->findOrFail($companyId);
            $name = self::cleanName($name);
            $names = $this->rules->known($permissions);
            self::requireFreeName($companyId, $name, null);
            $this->rules->requireHolds($actor, $companyId, $names);

            $role = new Role;
            $role->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $companyId, 'name' => $name,
                'guard_name' => CompanyRoleRules::GUARD, 'is_system' => false, 'permissions_edited' => false,
            ])->save();
            $this->rules->write($actor, $role, $names);

            $this->rules->forgetCache();
            $this->uow->afterCommit(fn () => $this->rules->forgetCache());
            $audit->add('company_role.created', $role, after: ['name' => $name, 'permissions' => $names]);

            return $role;
        });
    }

    public static function cleanName(string $name): string
    {
        $name = trim(preg_replace('/\s+/', ' ', $name) ?? $name);
        if ($name === '' || mb_strlen($name) > self::MAX_NAME) {
            throw DomainRuleViolation::single('role_name_invalid', 'A role name is 1 to '.self::MAX_NAME.' characters.');
        }

        return $name;
    }

    /** A name is free when no other role of the company has it (any letter case), seeded names included. */
    public static function requireFreeName(string $companyId, string $name, ?string $exceptRoleId): void
    {
        $lower = mb_strtolower($name);
        $reserved = array_map(mb_strtolower(...), PermissionMatrix::ROLES);
        $taken = Role::query()->where('company_id', $companyId)->where('guard_name', CompanyRoleRules::GUARD)
            ->when($exceptRoleId !== null, fn ($q) => $q->where('id', '<>', $exceptRoleId))
            ->get(['name'])->contains(fn (Role $r) => mb_strtolower($r->name) === $lower);
        if ($taken || in_array($lower, $reserved, true)) {
            throw DomainRuleViolation::single('role_name_taken', "The company already has a role called {$name}.");
        }
    }
}
