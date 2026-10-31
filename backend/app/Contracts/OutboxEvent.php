<?php

declare(strict_types=1);

namespace App\Contracts;

/** A domain event delivered through the transactional outbox (13 §15). */
interface OutboxEvent
{
    public function type(): string;

    /** @return array<string, mixed> */
    public function payload(): array;
}
