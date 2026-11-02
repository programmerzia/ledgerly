<?php

declare(strict_types=1);

namespace App\Support\Imports;

use App\Jobs\Imports\ApplyImportJob;

/**
 * Queues the apply job. With the `sync` queue (local development, tests) a tenant-aware job cannot run inside the caller's own tenant
 * context, so nothing is queued there: run `ApplyImportJob` from a worker (Horizon) or, in tests, dispatch it with the context cleared.
 */
final class ImportQueue
{
    public static function push(string $tenantId, string $companyId, string $importId): void
    {
        if (config('queue.default') === 'sync') {
            return;
        }
        ApplyImportJob::dispatch($tenantId, $companyId, $importId);
    }
}
