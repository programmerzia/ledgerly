<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Domain\Organisation\PermissionMatrix;
use App\Domain\Shared\DomainRuleViolation;
use App\Queries\Organisation\RoleHolderCount;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Spatie\Permission\PermissionRegistrar;

/** Removes a company role from a member. Only org owners and admins may do this. */
final class RevokeCompanyRole
{
    public function __construct(private readonly UnitOfWork $uow, private readonly PermissionRegistrar $registrar, private readonly RoleHolderCount $holderCount) {}

    public function handle(Actor $actor, CompanyRoleInput $in): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            [$user, $role] = AssignCompanyRole::resolve($actor, $in);

            $previous = $this->registrar->getPermissionsTeamId();
            $this->registrar->setPermissionsTeamId($in->companyId);
            try {
                if (! $user->hasRole($role)) {
                    return;
                }
                // A company must always have someone who holds Owner.
                if ($role->is_system && $role->name === PermissionMatrix::OWNER
                    && ($this->holderCount)($in->companyId, $role->id) <= 1) {
                    throw DomainRuleViolation::single('last_owner', 'This is the last Owner of the company. Give the role to someone else first.');
                }
                $user->removeRole($role);
            } finally {
                $this->registrar->setPermissionsTeamId($previous);
            }

            $audit->add('company_role.revoked', $role, before: ['user_id' => $user->id, 'role' => $role->name]);
        });
    }
}
