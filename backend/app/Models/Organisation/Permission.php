<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use Spatie\Permission\Models\Permission as SpatiePermission;

/**
 * Tenant-wide permission name (`module.action`), uuid key. Created by SeedCompanyRoles with an
 * explicit id from IdGenerator; tenant_id is stamped explicitly there too.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $name
 */
class Permission extends SpatiePermission
{
    public $incrementing = false;

    protected $keyType = 'string';
}
