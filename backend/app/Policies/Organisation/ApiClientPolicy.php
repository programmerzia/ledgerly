<?php

declare(strict_types=1);

namespace App\Policies\Organisation;

use App\Models\Organisation\ApiClient;
use App\Models\Platform\User;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** API clients are organisation-level (13 §7): owners and admins manage them, people only; a token never manages tokens. */
final class ApiClientPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->admin($principal);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->admin($principal);
    }

    public function revoke(Authenticatable $principal, ApiClient $client): bool
    {
        return $client->revoked_at === null && $this->admin($principal);
    }

    private function admin(Authenticatable $principal): bool
    {
        return $principal instanceof User && $this->context->isOrgAdmin($principal);
    }
}
