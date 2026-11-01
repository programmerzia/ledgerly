<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use App\Jobs\Webhooks\DeliverWebhook;

/**
 * Queues the delivery job. With the `sync` queue (local development) a tenant-aware job cannot run inside the
 * caller's own tenant context, so nothing is queued and the `webhooks:sweep` scheduler picks the row up instead.
 */
final class DeliveryQueue
{
    public static function push(string $tenantId, string $deliveryId): void
    {
        if (config('queue.default') === 'sync') {
            return;
        }
        DeliverWebhook::dispatch($tenantId, $deliveryId);
    }
}
