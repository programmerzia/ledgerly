<?php

declare(strict_types=1);

namespace App\Jobs\Files;

use App\Actions\Files\ScanAttachmentFile;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use DateTimeInterface;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Scans one uploaded file (13 §17). A scanner that is down makes the Action throw; the job is released with growing
 * backoff for up to a day and the file stays `pending`, never `clean`. Idempotent: a file that has a verdict is skipped.
 */
final class ScanAttachment implements ShouldQueue, TenantAware
{
    use Queueable;

    public int $tries = 0;

    public int $timeout = 120;

    public function __construct(public readonly string $tenant, public readonly string $company, public readonly string $attachmentId)
    {
        $this->onQueue('scans');
    }

    public function tenantId(): string
    {
        return $this->tenant;
    }

    public function companyId(): string
    {
        return $this->company;
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [app(WithTenantContext::class)];
    }

    /** @return list<int> seconds between attempts while the scanner is unreachable */
    public function backoff(): array
    {
        return [15, 30, 60, 120, 300, 600, 900, 1800, 3600];
    }

    public function retryUntil(): DateTimeInterface
    {
        return now()->addDay();
    }

    public function handle(ScanAttachmentFile $scan): void
    {
        $scan->handle($this->tenant, $this->company, $this->attachmentId);
    }
}
