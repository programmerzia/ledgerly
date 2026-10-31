<?php

declare(strict_types=1);

namespace App\Jobs\Outbox;

use App\Support\Outbox\OutboxRelay;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * After-commit kick (13 §15): relays one transaction's messages right away instead of waiting
 * for the sweep. Uses `TenantContext::run`, which restores the previous context, because with a
 * sync queue this runs inside the request that committed the messages.
 */
final class RelayOutboxMessages implements ShouldQueue
{
    use Queueable;

    /** @param list<string> $messageIds */
    public function __construct(public readonly string $tenantId, public readonly array $messageIds) {}

    public function handle(OutboxRelay $relay, TenantContext $tenant): void
    {
        $tenant->run($this->tenantId, fn () => $relay->relay($this->messageIds));
    }
}
