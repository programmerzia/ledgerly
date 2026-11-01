<?php

declare(strict_types=1);

namespace App\Support\Outbox;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Contracts\OutboxHandler;
use App\Models\Webhooks\WebhookEndpoint;
use App\Support\Tenancy\TenantContext;
use App\Support\Webhooks\DeliveryQueue;
use App\Support\Webhooks\WebhookEvents;
use Illuminate\Database\DatabaseManager;
use LogicException;

/**
 * Turns an outbox message into one pending delivery per subscribed, active endpoint of its tenant (13 §15).
 * Idempotent by message id: UNIQUE (endpoint_id, message_id) with ON CONFLICT DO NOTHING, so the
 * at-least-once relay never enqueues a message twice. A row whose queue push is lost is picked up by the
 * `webhooks:sweep` scheduler (it is due immediately). No HTTP happens here.
 */
final class WebhookOutboxHandler implements OutboxHandler
{
    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
    ) {}

    public function handle(OutboxMessage $message): void
    {
        if ($this->tenant->require() !== $message->tenantId) {
            throw new LogicException('The outbox message does not belong to the current tenant.');
        }

        $envelope = null;
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        foreach (WebhookEndpoint::query()->where('is_active', true)->orderBy('id')->get() as $endpoint) {
            if (! $endpoint->subscribesTo($message->type)) {
                continue;
            }
            $envelope ??= json_encode(WebhookEvents::envelope($message), JSON_THROW_ON_ERROR);

            $id = $this->ids->next();
            $rows = $this->db->connection()->select(
                'INSERT INTO webhook_deliveries (id, tenant_id, endpoint_id, message_id, event_type, payload, status, window_started_at, next_retry_at, created_at, updated_at) '
                ."VALUES (?, ?, ?, ?, ?, ?::jsonb, 'pending', ?, ?, ?, ?) ON CONFLICT (endpoint_id, message_id) DO NOTHING RETURNING id",
                [$id, $message->tenantId, $endpoint->id, $message->id, $message->type, $envelope, $now, $now, $now, $now],
            );
            if ($rows !== []) {
                DeliveryQueue::push($message->tenantId, $id);
            }
        }
    }
}
