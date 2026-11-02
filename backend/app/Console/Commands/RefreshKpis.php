<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\Practice\RefreshTenantKpis;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Database\DatabaseManager;
use LogicException;

/**
 * Every 15 s: queue a refresh job for each tenant whose practice-overview figures were flagged at least
 * `--debounce` seconds ago (13 §7). Waiting a few seconds lets a burst of postings settle into one recompute.
 */
final class RefreshKpis extends Command
{
    private const int BATCH = 200;

    protected $description = 'Queue practice-overview refreshes for tenants flagged by posting and period events';

    protected $signature = 'kpi:refresh {--debounce=5 : Seconds a flag must have waited}';

    public function handle(DatabaseManager $db, TenantContext $tenant): int
    {
        if ($tenant->id() !== null) {
            throw new LogicException('The KPI sweep must run without a tenant context.');
        }
        $rows = $db->connection()->select(
            'SELECT tenant_id FROM sysops.kpi_dirty_tenants(now() - make_interval(secs => ?), ?)',
            [max(0, (int) $this->option('debounce')), self::BATCH],
        );
        foreach ($rows as $row) {
            RefreshTenantKpis::dispatch((string) $row->tenant_id);
        }
        if ($rows !== []) {
            $this->info('Queued '.count($rows).' KPI refresh job(s).');
        }

        return self::SUCCESS;
    }
}
