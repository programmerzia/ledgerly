<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Domain\Organisation\PermissionMatrix;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Role;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Puts a seeded role back to the matrix's permissions and marks it unedited again, so it follows the matrix (plan 3c.25). */
final class ResetCompanyRole
{
    public function __construct(private readonly UnitOfWork $uow, private readonly CompanyRoleRules $rules) {}

    public function handle(Actor $actor, string $companyId, string $roleId): Role
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $roleId) {
            $this->rules->requireOrgAdmin($actor);
            $role = $this->rules->find($companyId, $roleId);
            if ($this->rules->isOwner($role)) {
                throw DomainRuleViolation::single('role_locked', 'The Owner role is locked: it always has every right.');
            }
            if (! $role->is_system) {
                throw DomainRuleViolation::single('role_not_system', 'Only the standard roles can be reset. A custom role has no defaults.');
            }

            $defaults = $this->rules->known(PermissionMatrix::forRole($role->name));
            $before = $this->rules->namesOf($role);
            $this->rules->requireHolds($actor, $companyId, array_values(array_diff($defaults, $before)));

            $this->rules->write($actor, $role, $defaults);
            $role->forceFill(['permissions_edited' => false])->save();

            $this->rules->forgetCache();
            $this->uow->afterCommit(fn () => $this->rules->forgetCache());
            $audit->add('company_role.reset', $role, before: ['name' => $role->name, 'permissions' => $before], after: ['name' => $role->name, 'permissions' => $defaults]);

            return $role;
        });
    }
}
