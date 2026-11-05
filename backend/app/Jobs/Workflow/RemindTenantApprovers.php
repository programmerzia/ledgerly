<?php

declare(strict_types=1);

namespace App\Jobs\Workflow;

use App\Actions\Workflow\RemindApprovers;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/** Hourly, per tenant (13 §15): remind the approvers of documents that have waited past their workflow's limit (plan 3c.7). */
final class RemindTenantApprovers implements ShouldQueue, TenantAware
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

    public function handle(RemindApprovers $remind): void
    {
        foreach (Company::query()->where('status', 'active')->orderBy('id')->get() as $company) {
            try {
                $remind->handle(Actor::system($this->tenant, $company->id), $company->id);
            } catch (Throwable $e) {
                Log::error('Approval reminders failed for a company.', ['tenant_id' => $this->tenant, 'company_id' => $company->id, 'error' => $e->getMessage()]);
            }
        }
    }
}
