<?php

declare(strict_types=1);

use App\Contracts\OutboxHandler;

return [
    /*
     * Message type => handlers (13 §15). A type with no handlers is simply marked dispatched.
     * Webhooks (2.16), notifications and search indexing register here.
     *
     * @var array<string, list<class-string<OutboxHandler>>>
     */
    'handlers' => [],
];
