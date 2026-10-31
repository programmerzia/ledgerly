<?php

declare(strict_types=1);

namespace App\Services\Tenancy;

use App\Support\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Spatie\Permission\PermissionRegistrar;

/**
 * spatie keeps the whole permission registry under one cache key and in registrar memory. In a
 * multi-tenant process (queue worker, tests, Octane) that would answer tenant B from tenant A's
 * data. This registrar keys the cache by the current tenant and drops its in-memory copy whenever
 * the tenant context changes. With `permission.cache.store = array` nothing survives the process.
 */
final class TenantAwarePermissionRegistrar extends PermissionRegistrar
{
    private string $baseCacheKey = '';

    private ?string $loadedFor = null;

    public function initializeCache(): void
    {
        parent::initializeCache();
        $this->baseCacheKey = $this->cacheKey;
        $this->loadedFor = null;
    }

    /**
     * @param  array<string, mixed>  $params
     * @return Collection<int, Model>
     */
    public function getPermissions(array $params = [], bool $onlyOne = false): Collection
    {
        $this->syncTenant();

        return parent::getPermissions($params, $onlyOne);
    }

    public function forgetCachedPermissions(): bool
    {
        $this->syncTenant();

        return parent::forgetCachedPermissions();
    }

    private function syncTenant(): void
    {
        $tenant = app(TenantContext::class)->id() ?? 'none';
        if ($tenant === $this->loadedFor) {
            return;
        }

        $this->cacheKey = $this->baseCacheKey.'.'.$tenant;
        $this->clearPermissionsCollection();
        $this->loadedFor = $tenant;
    }
}
