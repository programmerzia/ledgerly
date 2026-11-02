<?php

declare(strict_types=1);

namespace App\Domain\Signing;

use App\Domain\Shared\DomainRuleViolation;

/** Signing is locked after repeated wrong PINs; the response says when it opens again (`Retry-After`). */
final class SigningLocked extends DomainRuleViolation
{
    public function __construct(string $message, public readonly int $retryAfterSeconds)
    {
        parent::__construct('signing_locked', $message);
    }
}
