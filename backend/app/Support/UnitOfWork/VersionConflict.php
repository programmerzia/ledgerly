<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use App\Domain\Shared\DomainRuleViolation;

/** Optimistic lock failure on a draft (13 §8, §11): 409 with the server's version. */
final class VersionConflict extends DomainRuleViolation
{
    public function __construct(public readonly int $serverVersion, public readonly int $clientVersion)
    {
        parent::__construct('version_conflict', 'The document was changed by someone else.');
    }
}
