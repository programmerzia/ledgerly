<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use App\Actions\Webhooks\RecordWebhookAttempt;
use App\Contracts\Clock;
use App\Models\Webhooks\WebhookDelivery;
use App\Models\Webhooks\WebhookEndpoint;
use App\Support\Actor;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\DatabaseManager;

/**
 * Runs one delivery attempt (13 §15), inside the delivery's tenant:
 *   1. claim the row (a 5-minute lease on `next_retry_at`, so the job and the sweep never both send it);
 *   2. sign, resolve and check the target, send: no transaction is open during any of this;
 *   3. record the outcome in its own transaction (RecordWebhookAttempt).
 */
final class WebhookDeliverer
{
    public const int LEASE_SECONDS = 300;

    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly Clock $clock,
        private readonly SsrfGuard $guard,
        private readonly WebhookSender $sender,
        private readonly RecordWebhookAttempt $record,
    ) {}

    public function deliver(string $tenantId, string $deliveryId): void
    {
        if ($this->tenant->id() !== $tenantId) {
            throw new \LogicException('The delivery must run inside its own tenant context.');
        }
        $now = $this->clock->now();
        $claimed = $this->db->connection()->update(
            "UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ? AND status = 'pending' AND next_retry_at <= ?",
            [$now->modify('+'.self::LEASE_SECONDS.' seconds')->format('Y-m-d H:i:sP'), $deliveryId, $now->format('Y-m-d H:i:s.uP')],
        );
        if ($claimed === 0) {
            return;
        }

        $delivery = WebhookDelivery::query()->findOrFail($deliveryId);
        $endpoint = WebhookEndpoint::query()->find($delivery->endpoint_id);
        $actor = Actor::system($tenantId);
        if ($endpoint === null || ! $endpoint->is_active) {
            $this->record->handle($actor, $deliveryId, null, null, 'endpoint_disabled');

            return;
        }

        $result = $this->attempt($endpoint, $delivery, $now->getTimestamp());
        $this->record->handle($actor, $deliveryId, $result->status, $result->snippet, $result->error);
    }

    private function attempt(WebhookEndpoint $endpoint, WebhookDelivery $delivery, int $timestamp): SendResult
    {
        try {
            $target = $this->guard->resolve($endpoint->url);
        } catch (UnsafeWebhookTarget $e) {
            return SendResult::failed('blocked:'.$e->reason);
        }

        $body = json_encode($delivery->payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        return $this->sender->send($target, $body, [
            'User-Agent' => 'Ledgerly-Webhooks/1',
            'X-Ledgerly-Event' => $delivery->event_type,
            'X-Ledgerly-Event-Id' => $delivery->message_id,
            'X-Ledgerly-Delivery' => $delivery->id,
            WebhookSigner::HEADER => WebhookSigner::header($endpoint->secret, $timestamp, $body),
        ]);
    }
}
