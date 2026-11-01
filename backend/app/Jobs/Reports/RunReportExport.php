<?php

declare(strict_types=1);

namespace App\Jobs\Reports;

use App\Models\Organisation\Company;
use App\Services\Reports\ExportStore;
use App\Services\Reports\ReportExport;
use App\Support\Tenancy\TenantContext;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * A large export (13 §13): builds the file inside the tenant, stores it and marks the record ready. The
 * report reads from the reporting connection like the interactive API. The request that queued it was
 * audited; the file is fetched from `GET …/reports/exports/{id}`.
 */
final class RunReportExport implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    /** @param array<string, mixed> $input validated report parameters */
    public function __construct(
        public readonly string $tenantId,
        public readonly string $companyId,
        public readonly string $exportId,
        public readonly string $report,
        public readonly string $format,
        public readonly array $input,
    ) {
        $this->onQueue('exports');
    }

    public function handle(TenantContext $tenant, ReportExport $exports, ExportStore $store): void
    {
        // Heavy runs read the replica (13 §13). Restored afterwards: workers and sync queues share config.
        $previous = config('reports.connection');
        config(['reports.connection' => config('reports.export_connection')]);
        try {
            $this->export($tenant, $exports, $store);
        } finally {
            config(['reports.connection' => $previous]);
        }
    }

    private function export(TenantContext $tenant, ReportExport $exports, ExportStore $store): void
    {
        $tenant->run($this->tenantId, function () use ($exports, $store): void {
            $company = Company::query()->findOrFail($this->companyId);
            $plan = $exports->plan($this->report, $company, $this->input);

            $file = tempnam(sys_get_temp_dir(), 'report-export-');
            if ($file === false) {
                throw new \RuntimeException('No temporary file for the export.');
            }
            try {
                $exports->write($plan['table'], $this->format, $file);
                $store->ready($this->tenantId, $this->companyId, $this->exportId, $file);
            } finally {
                @unlink($file);
            }
        });
    }

    public function failed(Throwable $e): void
    {
        app(ExportStore::class)->failed($this->tenantId, $this->companyId, $this->exportId);
    }
}
