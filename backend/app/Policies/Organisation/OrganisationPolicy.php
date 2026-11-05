<?php

declare(strict_types=1);

namespace App\Policies\Organisation;

use App\Models\Platform\User;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** The organisation's own page (plan 3c.26): any active member reads the profile; owners and admins, people only, change it. */
final class OrganisationPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function view(Authenticatable $principal): bool
    {
        return $principal instanceof User && $this->context->orgRole($principal) !== null;
    }

    public function update(Authenticatable $principal): bool
    {
        return $principal instanceof User && $this->context->isOrgAdmin($principal);
    }
}
