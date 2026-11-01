<?php

declare(strict_types=1);

namespace App\Support\Reports;

use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Contracts\Cache\Repository;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;

/**
 * Where report Queries read and how their results are cached (13 §13).
 *
 *  - `db()` is the reporting connection (the replica in production). It is one of the tenant
 *    connections, so TenantContext puts the tenant GUC on it and RLS applies as on the primary.
 *  - `cached()` keys a result by tenant, company, report, parameter hash and the company's
 *    ledger_version. A posting bumps the version after commit, so the next read misses; nothing is ever
 *    shared between tenants or companies because both ids are part of the key.
 *
 * Replica lag: a read replica can still be behind the primary when the version has already moved. The
 * response says when it was computed (`generated_at`); lag itself is not simulated in tests.
 */
final class ReportRunner
{
    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly LedgerVersion $versions,
        private readonly Repository $cache,
    ) {}

    public function db(): Connection
    {
        /** @var string $name */
        $name = config('reports.connection');

        return $this->db->connection($name);
    }

    /**
     * @param  array<string, mixed>  $params  everything that changes the result
     * @param  Closure(): array<string, mixed>  $compute
     * @return array<string, mixed>
     */
    public function cached(string $companyId, string $report, array $params, Closure $compute): array
    {
        $tenantId = $this->tenant->require();
        $key = $this->key($tenantId, $companyId, $report, $params);

        /** @var array<string, mixed>|null $hit */
        $hit = $this->cache->get($key);
        if (is_array($hit)) {
            return $hit;
        }
        // Read the version before computing: a posting that lands mid-way leaves a result under the old
        // version, which nobody asks for any more.
        $result = $compute();
        $this->cache->put($key, $result, (int) config('reports.cache_ttl'));

        return $result;
    }

    /** @param array<string, mixed> $params */
    public function key(string $tenantId, string $companyId, string $report, array $params): string
    {
        $version = $this->versions->current($tenantId, $companyId);
        $hash = hash('sha256', json_encode(self::sorted($params), JSON_THROW_ON_ERROR).'|'.$this->chartStamp($companyId));

        return "report:{$tenantId}:{$companyId}:{$report}:{$hash}:v{$version}";
    }

    /** Account and dimension edits change names and sections without posting, so they are part of the key. */
    private function chartStamp(string $companyId): string
    {
        $row = $this->db()->selectOne(
            'SELECT (SELECT max(updated_at) FROM accounts WHERE company_id = ?) AS a, (SELECT max(updated_at) FROM dimension_values WHERE company_id = ?) AS d',
            [$companyId, $companyId],
        );

        return ($row->a ?? '').'|'.($row->d ?? '');
    }

    /**
     * @param  array<array-key, mixed>  $value
     * @return array<array-key, mixed>
     */
    private static function sorted(array $value): array
    {
        foreach ($value as $k => $v) {
            if (is_array($v)) {
                $value[$k] = self::sorted($v);
            }
        }
        ksort($value);

        return $value;
    }
}
