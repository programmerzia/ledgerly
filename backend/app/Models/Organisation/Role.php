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
 * @property bool $is_system one of the seven seeded roles (plan 3c.25)
 * @property bool $permissions_edited a seeded role whose permissions a person changed: seeding and backfills leave it alone
 */
class Role extends SpatieRole
{
    public $incrementing = false;

    protected $keyType = 'string';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['is_system' => 'boolean', 'permissions_edited' => 'boolean'];
    }
}
