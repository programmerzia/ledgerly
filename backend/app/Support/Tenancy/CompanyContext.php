<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

/**
 * The company a request or job works in (13 §6 company isolation). Set by `ResolveCompany` for
 * routes under /companies/{company} and by `WithTenantContext` for company jobs. Scoped binding:
 * reset between requests and jobs.
 */
final class CompanyContext
{
    private ?string $companyId = null;

    public function set(string $companyId): void
    {
        $this->companyId = $companyId;
    }

    public function clear(): void
    {
        $this->companyId = null;
    }

    public function id(): ?string
    {
        return $this->companyId;
    }

    public function require(): string
    {
        return $this->companyId ?? throw new NoTenantContext('No company context is set.');
    }
}
