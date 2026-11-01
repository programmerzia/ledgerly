<?php

declare(strict_types=1);

namespace App\Actions\Webhooks;

use App\Contracts\Clock;
use App\Domain\Webhooks\RetrySchedule;
use App\Models\Platform\Tenant;
use App\Models\Platform\TenantUser;
use App\Models\Platform\User;
use App\Models\Webhooks\WebhookDelivery;
use App\Models\Webhooks\WebhookEndpoint;
use App\Notifications\WebhookEndpointDisabledNotification;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Support\Facades\Notification;

/**
 * Records what one delivery attempt came back with (13 §15), after the HTTP call is over:
 * 2xx delivers; 410 gives up and disables the endpoint at once; anything else (other status, timeout,
 * refused target) schedules the next attempt with exponential back-off and jitter, and once the 24 h
 * window is spent the delivery fails and the endpoint is auto-disabled, audited, and its owners are told.
 */
final class RecordWebhookAttempt
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock) {}

    public function handle(Actor $actor, string $deliveryId, ?int $status, ?string $snippet, ?string $error): WebhookDelivery
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $deliveryId, $status, $snippet, $error) {
            $endpointId = (string) WebhookDelivery::query()->whereKey($deliveryId)->value('endpoint_id');
            $endpoint = $locks->document(WebhookEndpoint::query()->findOrFail($endpointId));
            $delivery = WebhookDelivery::query()->whereKey($deliveryId)->lockForUpdate()->firstOrFail();
            if ($delivery->status !== 'pending') {
                return $delivery;
            }

            $now = $this->clock->now();
            $columns = ['last_attempt_at' => $now, 'response_code' => $status, 'response_snippet' => $snippet, 'error' => $error];
            $disable = null;

            if ($error === 'endpoint_disabled') {
                $columns = ['status' => 'cancelled', 'next_retry_at' => null, 'error' => $error];
            } else {
                $attempts = $delivery->attempts + 1;
                $columns['attempts'] = $attempts;
                if ($status !== null && $status >= 200 && $status < 300) {
                    $columns = [...$columns, 'status' => 'delivered', 'delivered_at' => $now, 'next_retry_at' => null, 'error' => null];
                } elseif ($status === 410) {
                    $columns = [...$columns, 'status' => 'failed', 'next_retry_at' => null, 'error' => 'gone'];
                    $disable = 'gone';
                } else {
                    if ($status !== null && $status >= 300 && $status < 400) {
                        $columns['error'] = 'redirect_not_followed';
                    }
                    $next = RetrySchedule::nextAttempt(
                        $delivery->window_started_at->toDateTimeImmutable(), $now, $attempts,
                        (int) config('webhooks.retry_window_hours') * 3600, random_int(0, 999) / 1000,
                    );
                    if ($next === null) {
                        $columns = [...$columns, 'status' => 'failed', 'next_retry_at' => null];
                        $disable = 'failures';
                    } else {
                        $columns['next_retry_at'] = $next;
                    }
                }
            }
            $delivery->forceFill($columns)->save();

            if ($disable !== null && $endpoint->is_active) {
                $this->disable($actor, $endpoint, $delivery, $disable, $now, $audit);
            }

            return $delivery;
        });
    }

    private function disable(Actor $actor, WebhookEndpoint $endpoint, WebhookDelivery $delivery, string $reason, \DateTimeImmutable $now, AuditBuffer $audit): void
    {
        $endpoint->forceFill([
            'is_active' => false, 'disabled_at' => $now, 'disabled_reason' => $reason, 'lock_version' => $endpoint->lock_version + 1,
        ])->save();
        WebhookDelivery::query()->where('endpoint_id', $endpoint->id)->where('status', 'pending')->whereKeyNot($delivery->id)
            ->update(['status' => 'cancelled', 'next_retry_at' => null, 'error' => 'endpoint_disabled']);
        $audit->add('webhook_endpoint.auto_disabled', $endpoint, context: ['reason' => $reason, 'delivery_id' => $delivery->id, 'event_id' => $delivery->message_id]);

        $host = (string) parse_url($endpoint->url, PHP_URL_HOST);
        $organisation = (string) Tenant::query()->whereKey($actor->tenantId)->value('name');
        $owners = User::query()->whereIn('id', TenantUser::query()
            ->where('tenant_id', $actor->tenantId)->where('role', 'owner')->where('status', 'active')->select('user_id'))->get();
        $this->uow->afterCommit(fn () => Notification::send($owners, new WebhookEndpointDisabledNotification($host, $reason, $organisation)));
    }
}
