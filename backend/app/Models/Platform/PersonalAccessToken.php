<?php

declare(strict_types=1);

namespace App\Models\Platform;

use Laravel\Sanctum\PersonalAccessToken as SanctumPersonalAccessToken;

/**
 * @property string|null $tenant_id
 */
class PersonalAccessToken extends SanctumPersonalAccessToken
{
    protected $keyType = 'string';

    /** @var list<string> */
    protected $fillable = ['name', 'token', 'abilities', 'expires_at', 'tenant_id'];
}
