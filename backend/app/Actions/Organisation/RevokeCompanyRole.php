<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Spatie\Permission\PermissionRegistrar;

/** Removes a company role from a member. Only org owners and admins may do this. */
final class RevokeCompanyRole
{
    public function __construct(private readonly UnitOfWork $uow, private readonly PermissionRegistrar $registrar) {}

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
                $user->removeRole($role);
            } finally {
                $this->registrar->setPermissionsTeamId($previous);
            }

            $audit->add('company_role.revoked', $role, before: ['user_id' => $user->id, 'role' => $role->name]);
        });
    }
}
