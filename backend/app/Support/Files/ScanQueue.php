<?php

declare(strict_types=1);

namespace App\Support\Files;

use App\Jobs\Files\ScanAttachment;

/**
 * Queues the scan job. With the `sync` queue (local development) a tenant-aware job cannot run inside the caller's
 * own tenant context, so nothing is queued and the `attachments:scan-pending` scheduler picks the file up instead.
 */
final class ScanQueue
{
    public static function push(string $tenantId, string $companyId, string $attachmentId): void
    {
        if (config('queue.default') === 'sync') {
            return;
        }
        ScanAttachment::dispatch($tenantId, $companyId, $attachmentId);
    }
}
