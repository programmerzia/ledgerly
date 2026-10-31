<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use App\Contracts\OutboxEvent;

/** Events buffered during a UnitOfWork; written to outbox_messages in the same transaction. */
final class Outbox
{
    /** @var list<OutboxEvent> */
    private array $events = [];

    public function add(OutboxEvent $event): void
    {
        $this->events[] = $event;
    }

    /** @return list<OutboxEvent> */
    public function events(): array
    {
        return $this->events;
    }
}
