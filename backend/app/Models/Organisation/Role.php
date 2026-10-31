<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use Spatie\Permission\Models\Role as SpatieRole;

/**
 * A role belonging to one company (spatie team = company), uuid key.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $name
 */
class Role extends SpatieRole
{
    public $incrementing = false;

    protected $keyType = 'string';
}
