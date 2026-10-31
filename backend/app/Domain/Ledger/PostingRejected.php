<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;

final class PostingRejected extends DomainRuleViolation
{
    /** @param non-empty-list<Violation> $violations */
    public static function because(array $violations): self
    {
        return new self($violations[0]->code, 'The journal cannot be posted.', $violations);
    }
}
