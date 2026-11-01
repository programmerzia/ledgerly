<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Contracts\PermissionChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Support\Actor;

/**
 * The permission check shared by the setup Actions (accounts, dimensions, workflows), repeated here
 * because the UI and the route policy are never trusted (13 §7). A person needs the company
 * permission; an API client is let through only where `$tokens` is set, and then on the strength of
 * its token ability, which the route policy has already checked.
 */
final class SetupGuard
{
    public function __construct(private readonly PermissionChecker $permissions) {}

    public function require(Actor $actor, string $permission, string $companyId, bool $tokens = false): void
    {
        if ($actor->isApiClient() ? $tokens : $this->permissions->allows($actor, $permission, $companyId)) {
            return;
        }

        throw DomainRuleViolation::single('forbidden', "This needs the {$permission} permission.");
    }
}
