<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use App\Models\BaseModel;
use App\Models\Casts\PgUuidArray;
use Carbon\CarbonImmutable;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $email
 * @property string $role
 * @property string $token_hash
 * @property string|null $company_role
 * @property list<string>|null $company_ids
 * @property string $invited_by
 * @property CarbonImmutable $expires_at
 * @property CarbonImmutable|null $accepted_at
 * @property CarbonImmutable|null $revoked_at
 */
class Invitation extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['company_ids' => PgUuidArray::class, 'expires_at' => 'immutable_datetime', 'accepted_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime'];
    }
}
