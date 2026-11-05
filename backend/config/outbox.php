<?php

declare(strict_types=1);

use App\Contracts\OutboxHandler;
use App\Services\Notifications\NotificationPlanner;
use App\Support\Outbox\KpiOutboxHandler;
use App\Support\Outbox\NotificationOutboxHandler;
use App\Support\Outbox\WebhookOutboxHandler;
use App\Support\Webhooks\WebhookEvents;

return [
    /*
     * Message type => handlers (13 §15). A type with no handlers is simply marked dispatched.
     * Webhooks (2.16), notifications and search indexing register here.
     *
     * @var array<string, list<class-string<OutboxHandler>>>
     */
    'handlers' => array_merge_recursive(
        // Webhooks (13 §15): every event type integrators can subscribe to.
        WebhookEvents::handlerMap(WebhookOutboxHandler::class),
        // Practice overview (13 §7): posting, settlement, approval and period events flag the KPI snapshot.
        array_fill_keys(KpiOutboxHandler::TYPES, [KpiOutboxHandler::class]),
        // In-app notifications (plan 3c.6).
        array_fill_keys(NotificationPlanner::TYPES, [NotificationOutboxHandler::class]),
    ),
];
