<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Contracts\Clock;
use App\Jobs\Webhooks\DeliverWebhook;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Database\DatabaseManager;
use LogicException;

/**
 * Every 10 s: queue a delivery job for each webhook delivery whose time has come (13 §15), across tenants through
 * `sysops.webhook_deliveries_due`. This is the retry driver; the job claims the row, so queuing one twice is harmless.
 */
final class SweepWebhooks extends Command
{
    private const int BATCH = 500;

    protected $description = 'Queue webhook deliveries that are due (first attempts that missed the queue, and retries)';

    protected $signature = 'webhooks:sweep';

    public function handle(DatabaseManager $db, TenantContext $tenant, Clock $clock): int
    {
        if ($tenant->id() !== null) {
            throw new LogicException('The webhook sweep must run without a tenant context.');
        }
        $rows = $db->connection()->select('SELECT delivery_id, tenant_id FROM sysops.webhook_deliveries_due(?, ?)', [$clock->now()->format('Y-m-d H:i:s.uP'), self::BATCH]);
        foreach ($rows as $row) {
            DeliverWebhook::dispatch((string) $row->tenant_id, (string) $row->delivery_id);
        }
        if ($rows !== []) {
            $this->info('Queued '.count($rows).' delivery job(s).');
        }

        return self::SUCCESS;
    }
}
