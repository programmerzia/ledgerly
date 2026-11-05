<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\Workflow\RemindTenantApprovers;
use App\Support\Tenancy\TenantsDueFor;
use Illuminate\Console\Command;

/** Hourly: queue the approval-reminder run for every live tenant (13 §15, plan 3c.7). */
final class RemindApproversCommand extends Command
{
    protected $description = 'Queue the approval SLA reminders for every live tenant';

    protected $signature = 'approvals:remind';

    public function handle(TenantsDueFor $tenants): int
    {
        $count = 0;
        foreach ($tenants('approval_reminders') as $tenantId) {
            RemindTenantApprovers::dispatch($tenantId);
            $count++;
        }
        $this->info("Queued {$count} approval reminder run(s).");

        return self::SUCCESS;
    }
}
