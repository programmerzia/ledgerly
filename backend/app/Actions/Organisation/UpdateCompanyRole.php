<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Role;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Changes a role's permissions, and the name of a custom role (plan 3c.25).
 *  - Owner is locked: nothing about it changes.
 *  - A seeded role keeps its name; changing its permissions marks it edited, so seeding and backfills leave it alone from then on.
 *    Putting the permissions back to the matrix's makes it unedited again.
 *  - Organisation owners and admins only, and only rights they hold themselves can be added.
 */
final class UpdateCompanyRole
{
    public function __construct(private readonly UnitOfWork $uow, private readonly CompanyRoleRules $rules) {}

    /** @param list<string> $permissions the complete new set */
    public function handle(Actor $actor, string $companyId, string $roleId, ?string $name, array $permissions): Role
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $roleId, $name, $permissions) {
            $this->rules->requireOrgAdmin($actor);
            $role = $this->rules->find($companyId, $roleId);
            if ($this->rules->isOwner($role)) {
                throw DomainRuleViolation::single('role_locked', 'The Owner role is locked: it always has every right.');
            }

            $newName = $role->name;
            if ($name !== null && $name !== $role->name) {
                if ($role->is_system) {
                    throw DomainRuleViolation::single('role_name_fixed', "The name of {$role->name} cannot be changed. Copy it into a new role to use another name.");
                }
                $newName = CreateCompanyRole::cleanName($name);
                CreateCompanyRole::requireFreeName($companyId, $newName, $role->id);
            }

            $names = $this->rules->known($permissions);
            $before = $this->rules->namesOf($role);
            $this->rules->requireHolds($actor, $companyId, array_values(array_diff($names, $before)));

            $beforeState = ['name' => $role->name, 'permissions' => $before, 'edited' => $role->permissions_edited];
            $this->rules->write($actor, $role, $names);
            $role->forceFill([
                'name' => $newName,
                'permissions_edited' => $role->is_system && $this->rules->differsFromDefault($role, $names),
            ])->save();

            $this->rules->forgetCache();
            $this->uow->afterCommit(fn () => $this->rules->forgetCache());
            $audit->add('company_role.updated', $role, before: $beforeState, after: ['name' => $newName, 'permissions' => $names, 'edited' => $role->permissions_edited]);

            return $role;
        });
    }
}
