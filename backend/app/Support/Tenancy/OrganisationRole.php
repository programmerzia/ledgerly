<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use App\Models\Platform\TenantUser;

/** A user's active org role in a tenant (`tenant_users.role`, 13 §7), or null. */
final class OrganisationRole
{
    public static function of(string $tenantId, string $userId): ?string
    {
        $role = TenantUser::query()->where('tenant_id', $tenantId)->where('user_id', $userId)
            ->where('status', 'active')->value('role');

        return is_string($role) ? $role : null;
    }

    public static function isAdmin(?string $role): bool
    {
        return $role === 'owner' || $role === 'admin';
    }
}
