<?php

declare(strict_types=1);

namespace App\Jobs\Imports;

use App\Actions\Imports\ApplyImport;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * Applies a requested import on the `imports` queue (13 §15), inside its tenant and company. The signing grant was checked when apply
 * was requested (the queue has no session) and is recorded on the import; this job acts as the person who requested it. Safe to run
 * twice or to retry: finished imports are left alone and rows already applied are skipped.
 */
final class ApplyImportJob implements ShouldQueue, TenantAware
{
    use Queueable;

    public int $tries = 3;

    public int $timeout = 900;

    /** @var list<int> */
    public array $backoff = [30, 120];

    public function __construct(public readonly string $tenant, public readonly string $company, public readonly string $importId)
    {
        $this->onQueue((string) config('imports.queue', 'imports'));
        $this->afterCommit();
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

    public function handle(ApplyImport $apply): void
    {
        // A second attempt means the first one died part-way: take the import back from 'applying'.
        $apply->handle($this->tenant, $this->company, $this->importId, retry: $this->attempts() > 1);
    }
}
