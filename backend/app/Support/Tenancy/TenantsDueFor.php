<?php

declare(strict_types=1);

namespace App\Support\Tenancy;

use Generator;
use Illuminate\Database\DatabaseManager;
use LogicException;

/**
 * Tenant ids for a scheduled per-tenant job, paged through `sysops.tenants_due_for` (13 §6, §15).
 * Runs with no tenant context: the function is the only cross-tenant read the app role has.
 */
final class TenantsDueFor
{
    private const int PAGE = 500;

    public function __construct(private readonly DatabaseManager $db, private readonly TenantContext $tenant) {}

    /** @return Generator<int, string> */
    public function __invoke(string $job): Generator
    {
        if ($this->tenant->id() !== null) {
            throw new LogicException('Cross-tenant scheduling must run without a tenant context.');
        }
        $after = null;
        do {
            $ids = array_values(array_map(
                fn (object $r): string => (string) ((array) $r)['tenant_id'],
                $this->db->connection()->select('SELECT tenant_id FROM sysops.tenants_due_for(?, ?, ?)', [$job, $after, self::PAGE]),
            ));
            yield from $ids;
            $after = $ids === [] ? null : end($ids);
        } while (count($ids) === self::PAGE);
    }
}
