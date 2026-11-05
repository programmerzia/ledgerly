<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Domain\Shared\DomainRuleViolation;
use App\Queries\Organisation\RoleHolderCount;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Deletes a custom role nobody holds (plan 3c.25). The standard roles cannot be deleted; a role in use must be taken off its holders first. */
final class DeleteCompanyRole
{
    public function __construct(private readonly UnitOfWork $uow, private readonly CompanyRoleRules $rules, private readonly RoleHolderCount $holderCount) {}

    public function handle(Actor $actor, string $companyId, string $roleId): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $roleId) {
            $this->rules->requireOrgAdmin($actor);
            $role = $this->rules->find($companyId, $roleId);
            if ($role->is_system) {
                throw DomainRuleViolation::single('role_is_system', "{$role->name} is a standard role and cannot be deleted.");
            }
            $holders = ($this->holderCount)($companyId, $role->id);
            if ($holders > 0) {
                throw DomainRuleViolation::single('role_in_use', "{$role->name} is held by {$holders} ".($holders === 1 ? 'person' : 'people').'. Take it off them first.');
            }

            $before = ['name' => $role->name, 'permissions' => $this->rules->namesOf($role)];
            $role->permissions()->detach();
            $role->delete();

            $this->rules->forgetCache();
            $this->uow->afterCommit(fn () => $this->rules->forgetCache());
            $audit->add('company_role.deleted', $role, before: $before);
        });
    }
}
