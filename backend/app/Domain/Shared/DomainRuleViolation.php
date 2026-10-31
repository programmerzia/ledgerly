<?php

declare(strict_types=1);

namespace App\Domain\Shared;

use RuntimeException;

/**
 * A business rule was broken. `errorCode` is stable and maps to an HTTP status in
 * Support/Problem/StatusMap; `violations` lists every broken rule when there are several.
 */
class DomainRuleViolation extends RuntimeException
{
    /** @param list<Violation> $violations */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly array $violations = [],
    ) {
        parent::__construct($message);
    }

    public static function single(string $code, string $message): self
    {
        return new self($code, $message, [new Violation($code, $message)]);
    }
}
