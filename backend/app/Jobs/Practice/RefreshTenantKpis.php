<?php

declare(strict_types=1);

namespace App\Jobs\Practice;

use App\Models\Organisation\Company;
use App\Queries\Practice\CompanyKpis;
use App\Support\Tenancy\TenantAware;
use App\Support\Tenancy\WithTenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Database\DatabaseManager;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Recomputes the practice-overview figures of every active company of one tenant (13 §7). Queued by
 * `kpi:refresh` for tenants an outbox event flagged; one run per tenant at a time (a duplicate is dropped), and a flag set during the run survives
 * it (see `sysops.store_kpi_snapshots`), so a burst of postings costs one run, not one per posting. A company
 * that fails keeps its previous figures.
 */
final class RefreshTenantKpis implements ShouldQueue, TenantAware
{
    use Queueable;

    public int $tries = 1;

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
        return [app(WithTenantContext::class), (new WithoutOverlapping('kpi:'.$this->tenant))->dontRelease()->expireAfter(120)];
    }

    public function handle(CompanyKpis $kpis, DatabaseManager $db): void
    {
        $connection = $db->connection();
        $started = (string) ((array) $connection->selectOne('SELECT clock_timestamp() AS t'))['t'];

        $rows = [];
        foreach (Company::query()->where('status', 'active')->orderBy('id')->get() as $company) {
            try {
                $rows[] = $kpis($company);
            } catch (Throwable $e) {
                Log::error('KPI refresh failed for a company.', ['tenant_id' => $this->tenant, 'company_id' => $company->id, 'error' => $e->getMessage()]);

                return; // keep every previous figure rather than drop this company's row
            }
        }

        $connection->select('SELECT sysops.store_kpi_snapshots(?, ?, ?::jsonb)', [
            $this->tenant, $started, json_encode($rows, JSON_THROW_ON_ERROR),
        ]);
    }
}
