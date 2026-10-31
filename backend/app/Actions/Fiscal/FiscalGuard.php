<?php

declare(strict_types=1);

namespace App\Actions\Fiscal;

use App\Contracts\PermissionChecker;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fiscal\FiscalPeriod;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\LockSet;

/** Shared rules of the period Actions: people only, a company permission, and the PIN where ADR-0004 asks. */
final class FiscalGuard
{
    public function __construct(private readonly PermissionChecker $permissions) {}

    public function require(Actor $actor, string $permission, string $companyId, bool $signed = false): void
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can change period status.');
        }
        if (! $this->permissions->allows($actor, $permission, $companyId)) {
            throw DomainRuleViolation::single('forbidden', "This needs the {$permission} permission.");
        }
        if ($signed && ! $actor->hasSigningGrant) {
            throw DomainRuleViolation::single('signature_required', 'This needs your signing PIN.');
        }
    }

    /** Level 1 of the lock order, FOR UPDATE: the status is then read from the locked row. */
    public function lockPeriod(LockSet $locks, string $periodId): FiscalPeriod
    {
        $found = FiscalPeriod::query()->find($periodId);
        if ($found === null) {
            throw DomainRuleViolation::single('not_found', 'The period does not exist.');
        }

        return $locks->periodsById($found->company_id, [$found->id], forUpdate: true)[0];
    }
}
