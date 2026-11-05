<?php

declare(strict_types=1);

namespace App\Jobs\Documents;

use App\Actions\Documents\RunDunning;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/** Daily, per tenant (13 §15): overdue-invoice reminders for each active company that switched them on (plan 3c.7). */
final class RunTenantDunning implements ShouldQueue, TenantAware
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

    public function handle(RunDunning $run): void
    {
        foreach (Company::query()->where('status', 'active')->orderBy('id')->get() as $company) {
            try {
                $run->handle(Actor::system($this->tenant, $company->id), $company);
            } catch (Throwable $e) {
                Log::error('Overdue reminders failed for a company.', ['tenant_id' => $this->tenant, 'company_id' => $company->id, 'error' => $e->getMessage()]);
            }
        }
    }
}
