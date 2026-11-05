<?php

declare(strict_types=1);

namespace App\Actions\Organisation;

use App\Contracts\IdGenerator;
use App\Domain\Organisation\PermissionMatrix;
use App\Models\Organisation\Company;
use App\Models\Organisation\Permission;
use App\Models\Organisation\Role;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Spatie\Permission\PermissionRegistrar;

/**
 * Creates (idempotently) every matrix permission for the tenant and the seven roles of one company with the matrix's permissions.
 * Re-running repairs drift in an unedited seeded role and changes nothing otherwise: a role whose permissions a person edited
 * (plan 3c.25, `permissions_edited`) is left alone, so a new matrix permission reaches unedited seeded roles only. Owner is locked and
 * always follows the matrix. Custom roles are not in the matrix and are never touched.
 */
final class SeedCompanyRoles
{
    private const string GUARD = 'web';

    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly PermissionRegistrar $registrar,
    ) {}

    public function handle(Actor $actor, string $companyId): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId) {
            $company = Company::query()->findOrFail($companyId);
            $changed = false;
            $owner = null;

            /** @var array<string, string> $permissionIds name → id */
            $permissionIds = Permission::query()->where('guard_name', self::GUARD)->pluck('id', 'name')->all();
            foreach (PermissionMatrix::permissions() as $name) {
                if (! isset($permissionIds[$name])) {
                    $permission = new Permission;
                    $permission->forceFill([
                        'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'name' => $name, 'guard_name' => self::GUARD,
                    ])->save();
                    $permissionIds[$name] = $permission->id;
                    $changed = true;
                }
            }

            foreach (PermissionMatrix::ROLES as $roleName) {
                $role = Role::query()->where('company_id', $company->id)->where('name', $roleName)->where('guard_name', self::GUARD)->first();
                if ($role === null) {
                    $role = new Role;
                    $role->forceFill([
                        'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $company->id,
                        'name' => $roleName, 'guard_name' => self::GUARD, 'is_system' => true, 'permissions_edited' => false,
                    ])->save();
                    $changed = true;
                }

                $owner ??= $role;
                // A seeded role someone edited (plan 3c.25) is theirs now: no repair, and no new matrix permission. Owner is locked, so it
                // always follows the matrix. Custom roles are never touched here: they are not in the matrix at all.
                if ($role->permissions_edited && $roleName !== PermissionMatrix::OWNER) {
                    continue;
                }
                $wanted = array_map(fn (string $p) => $permissionIds[$p], PermissionMatrix::forRole($roleName));
                $synced = $role->permissions()->sync($wanted);
                $changed = $changed || $synced['attached'] !== [] || $synced['detached'] !== [];
            }

            $this->registrar->forgetCachedPermissions();

            if ($changed) {
                $audit->add('company_roles.seeded', $owner, context: ['company_id' => $company->id, 'roles' => PermissionMatrix::ROLES]);
            }
        });
    }
}
