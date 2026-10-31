<?php

declare(strict_types=1);

namespace App\Jobs\Audit;

use App\Support\Audit\AuditSealer;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/** Seals one tenant's audit chain (13 §14). Queued per tenant by `audit:seal`. */
final class SealAuditLog implements ShouldQueue, TenantAware
{
    use Queueable;

    public function __construct(public readonly string $tenant)
    {
        $this->onQueue('maintenance');
    }

    public function tenantId(): string
    {
        return $this->tenant;
    }

    public function companyId(): ?string
    {
        return null;
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [app(WithTenantContext::class)];
    }

    public function handle(AuditSealer $sealer): void
    {
        $sealer->seal();
    }
}
