<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\Documents\RunTenantDunning;
use App\Support\Tenancy\TenantsDueFor;
use Illuminate\Console\Command;

/** Daily: queue the overdue-invoice reminder run for every live tenant (13 §15, plan 3c.7). */
final class RunDunningCommand extends Command
{
    protected $description = 'Queue the overdue-invoice reminders for every live tenant';

    protected $signature = 'dunning:run';

    public function handle(TenantsDueFor $tenants): int
    {
        $count = 0;
        foreach ($tenants('dunning') as $tenantId) {
            RunTenantDunning::dispatch($tenantId);
            $count++;
        }
        $this->info("Queued {$count} overdue reminder run(s).");

        return self::SUCCESS;
    }
}
