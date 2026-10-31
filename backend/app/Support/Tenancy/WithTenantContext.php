<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use Closure;
use LogicException;

/**
 * Job middleware for `TenantAware` jobs (13 §6). Refuses to start when a context is already set
 * (a previous job leaked it), runs the job inside its own tenant and company, and always clears.
 */
final class WithTenantContext
{
    public function __construct(private readonly TenantContext $tenant, private readonly CompanyContext $company) {}

    public function handle(TenantAware $job, Closure $next): mixed
    {
        if ($this->tenant->id() !== null) {
            throw new LogicException('A tenant context was still set at job start.');
        }

        $this->tenant->set($job->tenantId());
        $companyId = $job->companyId();
        if ($companyId !== null) {
            $this->company->set($companyId);
        }

        try {
            return $next($job);
        } finally {
            $this->company->clear();
            $this->tenant->clear();
        }
    }
}
