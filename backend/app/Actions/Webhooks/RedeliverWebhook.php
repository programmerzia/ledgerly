<?php

declare(strict_types=1);

namespace App\Actions\Webhooks;

use App\Actions\Organisation\OrganisationAdmin;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Webhooks\WebhookDelivery;
use App\Models\Webhooks\WebhookEndpoint;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use App\Support\Webhooks\DeliveryQueue;

/**
 * Sends a past delivery again (same event id, so receivers can de-duplicate): resets it to pending with a fresh
 * 24 h window and queues it after commit. The endpoint must be active.
 */
final class RedeliverWebhook
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock) {}

    public function handle(Actor $actor, string $endpointId, string $deliveryId): WebhookDelivery
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $endpointId, $deliveryId) {
            OrganisationAdmin::require($actor, 'Only organisation owners and admins can redeliver webhooks.');
            $endpoint = $locks->document(WebhookEndpoint::query()->findOrFail($endpointId));
            $delivery = WebhookDelivery::query()->where('endpoint_id', $endpoint->id)->whereKey($deliveryId)->lockForUpdate()->firstOrFail();
            if (! $endpoint->is_active) {
                throw DomainRuleViolation::single('webhook_endpoint_disabled', 'Enable the endpoint before redelivering.');
            }
            if ($delivery->status === 'pending') {
                throw DomainRuleViolation::single('webhook_delivery_pending', 'The delivery is already waiting to be sent.');
            }

            $now = $this->clock->now();
            $delivery->forceFill([
                'status' => 'pending', 'attempts' => 0, 'window_started_at' => $now, 'next_retry_at' => $now,
                'delivered_at' => null, 'response_code' => null, 'response_snippet' => null, 'error' => null,
            ])->save();
            $audit->add('webhook_delivery.redelivered', $delivery, context: ['endpoint_id' => $endpoint->id, 'event_id' => $delivery->message_id]);
            $this->uow->afterCommit(fn () => DeliveryQueue::push($actor->tenantId, $delivery->id));

            return $delivery;
        });
    }
}
