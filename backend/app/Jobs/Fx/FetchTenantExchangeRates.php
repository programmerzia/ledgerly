<?php

declare(strict_types=1);

namespace App\Jobs\Fx;

use App\Actions\Fx\FetchExchangeRates;
use App\Actions\Fx\ReverseFxRevaluation;
use App\Contracts\ExchangeRateProvider;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\Fx\RateProviderFailed;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Daily, per tenant (13 §15): fetch the provider's rates once and store them for each of the tenant's companies,
 * then retry any FX revaluation reversal still waiting for its period. A provider failure is logged and leaves the
 * existing rates alone; it never fails the job, so the reversals still happen.
 */
final class FetchTenantExchangeRates implements ShouldQueue, TenantAware
{
    use Queueable;

    public function __construct(public readonly string $tenant)
    {
        $this->onQueue('maintenance');
    }

    public function tenantId(): string
    {
        return $this->tenant;
    }

    public function companyId(): ?string
    {
        return null;
    }

    /** @return list<object> */
    public function middleware(): array
    {
        return [app(WithTenantContext::class)];
    }

    public function handle(ExchangeRateProvider $provider, FetchExchangeRates $fetch, ReverseFxRevaluation $reversals): void
    {
        $feed = null;
        try {
            $feed = $provider->latest();
        } catch (RateProviderFailed $e) {
            Log::warning('Daily exchange-rate fetch failed; existing rates kept.', ['tenant_id' => $this->tenant, 'provider' => $provider->name(), 'error' => $e->getMessage()]);
        }

        foreach (Company::query()->where('status', 'active')->orderBy('id')->get() as $company) {
            try {
                $system = Actor::system($this->tenant, $company->id);
                if ($feed !== null) {
                    $fetch->handle($system, $company->id, $feed);
                }
                $reversals->pending($this->tenant, $company->id);
            } catch (Throwable $e) {
                // One company's trouble must not starve the others.
                Log::error('Exchange-rate job failed for a company.', ['tenant_id' => $this->tenant, 'company_id' => $company->id, 'error' => $e->getMessage()]);
            }
        }
    }
}
