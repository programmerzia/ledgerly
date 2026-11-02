<?php

declare(strict_types=1);

namespace App\Policies\Organisation;

use App\Models\Platform\User;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Seeing the organisation's people and company roles: owners and admins, people only. */
final class MemberPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $principal instanceof User && $this->context->isOrgAdmin($principal);
    }
}
