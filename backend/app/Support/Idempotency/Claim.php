<?php

declare(strict_types=1);

namespace App\Support\Idempotency;

final readonly class Claim
{
    public function __construct(
        public ClaimOutcome $outcome,
        public string $id,
        public ?int $responseStatus = null,
        public ?string $responseBody = null,
        public ?string $subjectType = null,
        public ?string $subjectId = null,
    ) {}
}
