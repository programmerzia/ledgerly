<?php

declare(strict_types=1);

return [
    // 13 §13: interactive reports read the primary, so people see their own postings at once. Queued
    // exports read the replica. Both get the tenant GUC through TenantContext; replica lag is not simulated
    // in tests, where both point at the same database.
    'connection' => env('REPORTS_CONNECTION', 'pgsql'),
    'export_connection' => env('REPORTS_EXPORT_CONNECTION', 'pgsql_report'),

    // How long a cached result may live. The ledger_version in the key is what makes a posting invalidate it.
    'cache_ttl' => (int) env('REPORTS_CACHE_TTL', 3600),

    // Exports with more rows than this run as a queued job (13 §13), the rest stream in the response.
    'export_inline_max_rows' => (int) env('REPORTS_EXPORT_INLINE_MAX_ROWS', 5000),

    // Disk and lifetime (minutes) of finished queued exports.
    'export_disk' => env('REPORTS_EXPORT_DISK', 'local'),
    'export_ttl_minutes' => (int) env('REPORTS_EXPORT_TTL_MINUTES', 1440),

    // Chromium for PDF exports (Browsershot). Empty: let Browsershot find it.
    'chromium_path' => env('REPORTS_CHROMIUM_PATH', ''),

    // Where node finds the `puppeteer` module (NODE_PATH). Empty: the global `npm root -g`.
    'node_module_path' => env('REPORTS_NODE_MODULE_PATH', ''),

    // 13 §16: exports are limited per company.
    'exports_per_hour' => 10,
];
