<?php

declare(strict_types=1);

namespace App\Support\Outbox;

final readonly class OutboxMessage
{
    /** @param array<string, mixed> $payload */
    public function __construct(
        public string $id,
        public string $tenantId,
        public string $type,
        public array $payload,
        public string $occurredAt,
        public int $attempts,
    ) {}
}
