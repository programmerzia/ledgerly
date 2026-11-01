<?php

declare(strict_types=1);

namespace App\Support\Reports;

use Illuminate\Contracts\Cache\Repository;

/**
 * The per-company counter behind the report cache key (13 §13). UnitOfWork bumps it after the commit of any
 * transaction that changed the company's balances, so a cached report can never outlive a posting.
 *
 * A counter that is missing (flushed, evicted) restarts at a random epoch instead of at zero, so a key
 * built from an older value can never be hit again by accident.
 */
final class LedgerVersion
{
    public function __construct(private readonly Repository $cache) {}

    public function current(string $tenantId, string $companyId): int
    {
        $key = self::key($tenantId, $companyId);
        $this->cache->add($key, self::epoch());

        return (int) $this->cache->get($key);
    }

    public function bump(string $tenantId, string $companyId): void
    {
        $key = self::key($tenantId, $companyId);
        $this->cache->add($key, self::epoch());
        $this->cache->increment($key);
    }

    private static function key(string $tenantId, string $companyId): string
    {
        return "ledger_version:{$tenantId}:{$companyId}";
    }

    private static function epoch(): int
    {
        return random_int(1_000_000, 2_000_000_000);
    }
}
