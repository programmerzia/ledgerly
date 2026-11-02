<?php

declare(strict_types=1);

namespace App\Jobs\Recurring;

use App\Actions\Recurring\RunRecurringSchedules;
use App\Contracts\Clock;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Daily, per tenant (13 §15): for each active company, create the drafts of every recurring schedule that is due,
 * as the system, "today" being the company's own date. Creates drafts only; people submit-approve what it leaves.
 * One company's failure is logged and does not stop the others.
 */
final class RunTenantRecurringSchedules implements ShouldQueue, TenantAware
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

    public function handle(RunRecurringSchedules $run, Clock $clock): void
    {
        foreach (Company::query()->where('status', 'active')->orderBy('id')->get() as $company) {
            try {
                $today = new DateTimeImmutable($clock->now()->setTimezone(new DateTimeZone($company->timezone))->format('Y-m-d'));
                $summary = $run->handle(Actor::system($this->tenant, $company->id), $company->id, $today);
                foreach ($summary->failures as $scheduleId => $reason) {
                    Log::warning('A recurring schedule could not run.', ['tenant_id' => $this->tenant, 'company_id' => $company->id, 'schedule_id' => $scheduleId, 'reason' => $reason]);
                }
            } catch (Throwable $e) {
                Log::error('Recurring schedules failed for a company.', ['tenant_id' => $this->tenant, 'company_id' => $company->id, 'error' => $e->getMessage()]);
            }
        }
    }
}
