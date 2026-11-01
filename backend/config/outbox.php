<?php

declare(strict_types=1);

use App\Contracts\OutboxHandler;
use App\Support\Outbox\WebhookOutboxHandler;
use App\Support\Webhooks\WebhookEvents;

return [
    /*
     * Message type => handlers (13 §15). A type with no handlers is simply marked dispatched.
     * Webhooks (2.16), notifications and search indexing register here.
     *
     * @var array<string, list<class-string<OutboxHandler>>>
     */
    'handlers' => [
        // Webhooks (13 §15): every event type integrators can subscribe to.
        ...WebhookEvents::handlerMap(WebhookOutboxHandler::class),
    ],
];
