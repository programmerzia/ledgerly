<?php

declare(strict_types=1);

namespace App\Models\Organisation;

use App\Models\BaseModel;
use App\Models\Casts\PgUuidArray;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Laravel\Sanctum\HasApiTokens;
use Laravel\Sanctum\NewAccessToken;

/**
 * Integrator principal (13 §7): the Sanctum tokenable for bearer-token API access.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $name
 * @property list<string> $company_ids
 * @property CarbonImmutable|null $revoked_at
 */
class ApiClient extends BaseModel implements AuthenticatableContract
{
    use Authenticatable;
    use HasApiTokens {
        createToken as private createSanctumToken;
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['company_ids' => PgUuidArray::class, 'last_used_at' => 'immutable_datetime', 'revoked_at' => 'immutable_datetime'];
    }

    /**
     * Tokens carry the client's tenant so the request pipeline can set the tenant context before
     * Sanctum loads this RLS-protected model (`SetTenantFromToken`).
     *
     * @param  list<string>  $abilities
     */
    public function createToken(string $name, array $abilities = ['*'], ?DateTimeInterface $expiresAt = null): NewAccessToken
    {
        $token = $this->createSanctumToken($name, $abilities, $expiresAt);
        $token->accessToken->forceFill(['tenant_id' => $this->tenant_id])->save();

        return $token;
    }
}
