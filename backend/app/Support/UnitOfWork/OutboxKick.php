<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

/** The outbox messages one transaction wrote, relayed right after it commits. */
final readonly class OutboxKick
{
    /** @param list<string> $messageIds */
    public function __construct(public string $tenantId, public array $messageIds) {}
}
