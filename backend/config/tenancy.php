<?php

declare(strict_types=1);

return [
    /*
     * Connections that carry the app.tenant_id GUC (13 §6). TenantContext sets it on every open
     * one; the ConnectionEstablished listener re-applies it on (re)connect.
     */
    'connections' => ['pgsql', 'pgsql_audit', 'pgsql_report'],

    /* Lock-order violations throw outside production and are logged in production (13 §8). */
    'strict_lock_order' => env('LEDGERLY_STRICT_LOCK_ORDER', env('APP_ENV') !== 'production'),
];
