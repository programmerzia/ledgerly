<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\Recurring\RunTenantRecurringSchedules;
use App\Support\Tenancy\TenantsDueFor;
use Illuminate\Console\Command;

/** Daily: queue the recurring-schedule run for every live tenant (13 §15). */
final class RunRecurringSchedulesCommand extends Command
{
    protected $description = 'Queue the daily run of recurring invoices, bills and journals for every live tenant';

    protected $signature = 'recurring:run';

    public function handle(TenantsDueFor $tenants): int
    {
        $count = 0;
        foreach ($tenants('recurring') as $tenantId) {
            RunTenantRecurringSchedules::dispatch($tenantId);
            $count++;
        }
        $this->info("Queued {$count} recurring run(s).");

        return self::SUCCESS;
    }
}
