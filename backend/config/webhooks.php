<?php

declare(strict_types=1);

return [
    /* Plain http targets are accepted only in local and testing; everywhere else delivery needs https (13 §15). */
    'allow_http' => in_array(env('APP_ENV'), ['local', 'testing'], true),

    /* Seconds. Short on purpose: a slow receiver must not hold a worker. */
    'connect_timeout' => 5,
    'timeout' => 10,

    /* The response body kept for the owner's delivery log, in bytes (never more is read). */
    'snippet_bytes' => 512,

    /* Endpoints per organisation until plan limits (4.6) take over. */
    'max_endpoints' => 25,

    /* Retries back off for this long from the first attempt, then the endpoint is auto-disabled. */
    'retry_window_hours' => 24,
];
