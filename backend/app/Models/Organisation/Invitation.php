<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use App\Models\BaseModel;
use App\Models\Casts\PgUuidArray;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $email
 * @property string $role
 * @property string $token_hash
 */
class Invitation extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['company_ids' => PgUuidArray::class, 'expires_at' => 'immutable_datetime', 'accepted_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime'];
    }
}
