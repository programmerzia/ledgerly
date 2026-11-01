<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Jobs\Fx\FetchTenantExchangeRates;
use App\Support\Tenancy\TenantsDueFor;
use Illuminate\Console\Command;

/** Daily: queue a rate fetch (and pending revaluation reversals) for every live tenant (13 §15). */
final class FetchExchangeRatesCommand extends Command
{
    protected $description = 'Queue the daily exchange-rate fetch for every live tenant';

    protected $signature = 'fx:fetch-rates';

    public function handle(TenantsDueFor $tenants): int
    {
        $count = 0;
        foreach ($tenants('fx_rates') as $tenantId) {
            FetchTenantExchangeRates::dispatch($tenantId);
            $count++;
        }
        $this->info("Queued {$count} rate fetch(es).");

        return self::SUCCESS;
    }
}
