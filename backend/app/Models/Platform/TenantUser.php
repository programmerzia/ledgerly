<?php

declare(strict_types=1);

namespace App\Models\Platform;

use Illuminate\Database\Eloquent\Model;

/**
 * Membership of a user in a tenant with an org role (owner | admin | member). Composite key:
 * query by tenant_id + user_id, never by find().
 *
 * @property string $tenant_id
 * @property string $user_id
 * @property string $role
 * @property string $status
 */
class TenantUser extends Model
{
    public $incrementing = false;

    protected $guarded = [];
}
