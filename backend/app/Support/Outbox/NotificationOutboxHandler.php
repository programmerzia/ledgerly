<?php

declare(strict_types=1);

namespace App\Support\Outbox;

use App\Contracts\OutboxHandler;
use App\Services\Notifications\NotificationPlanner;
use App\Services\Notifications\NotificationWriter;
use App\Support\Tenancy\TenantContext;
use LogicException;

/**
 * Fills the bell from outbox messages (plan 3c.6, 13 §15). Idempotent per message: the stored rows are keyed
 * `outbox:{message id}` per person, so a retried or doubly relayed message adds nothing.
 */
final class NotificationOutboxHandler implements OutboxHandler
{
    public function __construct(private readonly TenantContext $tenant, private readonly NotificationPlanner $planner, private readonly NotificationWriter $writer) {}

    public function handle(OutboxMessage $message): void
    {
        if ($this->tenant->require() !== $message->tenantId) {
            throw new LogicException('The outbox message does not belong to the current tenant.');
        }
        $this->writer->store($message->tenantId, $this->planner->plan($message));
    }
}
