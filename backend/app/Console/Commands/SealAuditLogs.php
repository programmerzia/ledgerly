<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\Audit\SealAuditLog;
use App\Support\Tenancy\TenantsDueFor;
use Illuminate\Console\Command;

/** Nightly: queue a seal of every live tenant's audit chain (13 §14). */
final class SealAuditLogs extends Command
{
    protected $description = 'Queue an audit-chain seal for every live tenant';

    protected $signature = 'audit:seal';

    public function handle(TenantsDueFor $tenants): int
    {
        $count = 0;
        foreach ($tenants('audit_seal') as $tenantId) {
            SealAuditLog::dispatch($tenantId);
            $count++;
        }
        $this->info("Queued {$count} seal(s).");

        return self::SUCCESS;
    }
}
