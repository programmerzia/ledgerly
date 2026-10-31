<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

/**
 * A queued job that works inside one tenant (13 §6). `WithTenantContext` sets the context from these
 * values at job start and clears it in `finally`, so long-lived workers never carry a tenant from
 * one job into the next.
 */
interface TenantAware
{
    public function tenantId(): string;

    public function companyId(): ?string;
}
