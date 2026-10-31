<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Actions\Organisation\Inputs\CompanyRoleInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Organisation\Company;
use App\Models\Organisation\Role;
use App\Models\Platform\TenantUser;
use App\Models\Platform\User;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Spatie\Permission\PermissionRegistrar;

/** Gives an active tenant member a company role. Only org owners and admins may do this. */
final class AssignCompanyRole
{
    public function __construct(private readonly UnitOfWork $uow, private readonly PermissionRegistrar $registrar) {}

    public function handle(Actor $actor, CompanyRoleInput $in): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            [$user, $role] = self::resolve($actor, $in);

            $previous = $this->registrar->getPermissionsTeamId();
            $this->registrar->setPermissionsTeamId($in->companyId);
            try {
                if ($user->hasRole($role)) {
                    return;
                }
                $user->assignRole($role);
            } finally {
                $this->registrar->setPermissionsTeamId($previous);
            }

            $audit->add('company_role.assigned', $role, after: ['user_id' => $user->id, 'role' => $role->name]);
        });
    }

    /**
     * Shared guard for assign and revoke.
     *
     * @return array{User, Role}
     */
    public static function resolve(Actor $actor, CompanyRoleInput $in): array
    {
        $isAdmin = $actor->type === ActorType::User && $actor->id !== null
            && TenantUser::query()->where('tenant_id', $actor->tenantId)->where('user_id', $actor->id)
                ->where('status', 'active')->whereIn('role', ['owner', 'admin'])->exists();
        if (! $isAdmin) {
            throw DomainRuleViolation::single('forbidden', 'Only organisation owners and admins can manage company roles.');
        }

        Company::query()->findOrFail($in->companyId);

        $member = TenantUser::query()->where('tenant_id', $actor->tenantId)->where('user_id', $in->userId)->where('status', 'active')->exists();
        if (! $member) {
            throw DomainRuleViolation::single('user_not_in_tenant', 'The user is not an active member of this organisation.');
        }

        $role = Role::query()->where('company_id', $in->companyId)->where('name', $in->roleName)->where('guard_name', 'web')->first();
        if ($role === null) {
            throw DomainRuleViolation::single('role_not_found', "The company has no role named {$in->roleName}.");
        }

        return [User::query()->findOrFail($in->userId), $role];
    }
}
