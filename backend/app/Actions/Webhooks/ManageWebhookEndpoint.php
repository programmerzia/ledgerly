<?php

declare(strict_types=1);

namespace App\Actions\Webhooks;

use App\Actions\Organisation\OrganisationAdmin;
use App\Actions\Webhooks\Inputs\WebhookEndpointInput;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Webhooks\WebhookDelivery;
use App\Models\Webhooks\WebhookEndpoint;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use App\Support\Webhooks\SsrfGuard;
use App\Support\Webhooks\UnsafeWebhookTarget;
use App\Support\Webhooks\WebhookEvents;
use App\Support\Webhooks\WebhookSigner;

/**
 * Webhook endpoints of the organisation (13 §15): owners and admins, people only. The signing secret is
 * generated here and only ever leaves in the create and rotate responses; audit rows never hold it
 * (the model hides it). Where the URL points is checked again at every delivery.
 */
final class ManageWebhookEndpoint
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly SsrfGuard $guard,
    ) {}

    public function create(Actor $actor, WebhookEndpointInput $in): WebhookEndpoint
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->requireAdmin($actor);
            $this->assertInput($in);
            if (WebhookEndpoint::query()->count() >= (int) config('webhooks.max_endpoints')) {
                throw DomainRuleViolation::single('webhook_limit_reached', 'The organisation has reached its limit of webhook endpoints.');
            }

            $endpoint = new WebhookEndpoint;
            $endpoint->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'url' => $in->url,
                'description' => $in->description, 'events' => $this->events($in), 'secret' => WebhookSigner::newSecret(),
                'is_active' => true, 'created_by' => $actor->id,
            ])->save();
            $endpoint->refresh();
            $audit->add('webhook_endpoint.created', $endpoint, after: $endpoint);

            return $endpoint;
        });
    }

    public function update(Actor $actor, string $endpointId, int $version, WebhookEndpointInput $in): WebhookEndpoint
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $endpointId, $version, $in) {
            $this->requireAdmin($actor);
            $endpoint = $locks->document(WebhookEndpoint::query()->findOrFail($endpointId), $version);
            $this->assertInput($in);

            $before = $endpoint->attributesToArray();
            $endpoint->forceFill([
                'url' => $in->url, 'description' => $in->description, 'events' => $this->events($in),
                'lock_version' => $endpoint->lock_version + 1,
            ])->save();
            $endpoint->refresh();
            $audit->add('webhook_endpoint.updated', $endpoint, before: $before, after: $endpoint);

            return $endpoint;
        });
    }

    /** Replaces the secret at once: deliveries from now on are signed with the new one. */
    public function rotateSecret(Actor $actor, string $endpointId): WebhookEndpoint
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $endpointId) {
            $this->requireAdmin($actor);
            $endpoint = $locks->document(WebhookEndpoint::query()->findOrFail($endpointId));

            $endpoint->forceFill([
                'secret' => WebhookSigner::newSecret(), 'secret_rotated_at' => $this->clock->now(),
                'lock_version' => $endpoint->lock_version + 1,
            ])->save();
            $endpoint->refresh();
            $audit->add('webhook_endpoint.secret_rotated', $endpoint);

            return $endpoint;
        });
    }

    public function disable(Actor $actor, string $endpointId): WebhookEndpoint
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $endpointId) {
            $this->requireAdmin($actor);
            $endpoint = $locks->document(WebhookEndpoint::query()->findOrFail($endpointId));
            if (! $endpoint->is_active) {
                return $endpoint;
            }

            $endpoint->forceFill([
                'is_active' => false, 'disabled_at' => $this->clock->now(), 'disabled_reason' => 'manual',
                'lock_version' => $endpoint->lock_version + 1,
            ])->save();
            WebhookDelivery::query()->where('endpoint_id', $endpoint->id)->where('status', 'pending')
                ->update(['status' => 'cancelled', 'next_retry_at' => null, 'error' => 'endpoint_disabled']);
            $endpoint->refresh();
            $audit->add('webhook_endpoint.disabled', $endpoint, context: ['reason' => 'manual']);

            return $endpoint;
        });
    }

    /** Turns a disabled endpoint back on. Deliveries cancelled while it was off stay cancelled; redeliver what was missed. */
    public function enable(Actor $actor, string $endpointId): WebhookEndpoint
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $endpointId) {
            $this->requireAdmin($actor);
            $endpoint = $locks->document(WebhookEndpoint::query()->findOrFail($endpointId));
            if ($endpoint->is_active) {
                return $endpoint;
            }

            $endpoint->forceFill([
                'is_active' => true, 'disabled_at' => null, 'disabled_reason' => null, 'lock_version' => $endpoint->lock_version + 1,
            ])->save();
            $endpoint->refresh();
            $audit->add('webhook_endpoint.enabled', $endpoint);

            return $endpoint;
        });
    }

    private function requireAdmin(Actor $actor): void
    {
        OrganisationAdmin::require($actor, 'Only organisation owners and admins can manage webhooks.');
    }

    private function assertInput(WebhookEndpointInput $in): void
    {
        try {
            $this->guard->assertShape($in->url);
        } catch (UnsafeWebhookTarget $e) {
            throw DomainRuleViolation::single('webhook_url_invalid', $e->getMessage());
        }
        $unknown = array_diff($in->events, WebhookEvents::subscribable());
        if ($in->events === [] || $unknown !== []) {
            throw DomainRuleViolation::single('webhook_events_invalid', 'Choose at least one known event type.');
        }
    }

    /** @return list<string> */
    private function events(WebhookEndpointInput $in): array
    {
        $events = array_values(array_unique($in->events));
        sort($events);

        return $events;
    }
}
