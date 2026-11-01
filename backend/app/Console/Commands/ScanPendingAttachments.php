<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Contracts\Clock;
use App\Jobs\Files\ScanAttachment;
use App\Models\Files\Attachment;
use App\Support\Tenancy\TenantContext;
use App\Support\Tenancy\TenantsDueFor;
use Illuminate\Console\Command;

/**
 * Every minute: queue a scan for uploaded files still `pending` that nobody has tried for five minutes (13 §17). Covers a
 * scanner outage longer than a job's retries, a lost queue message, and the `sync` queue of local development.
 */
final class ScanPendingAttachments extends Command
{
    private const int BATCH = 200;

    protected $description = 'Queue scans for uploaded attachments that are still pending';

    protected $signature = 'attachments:scan-pending';

    public function handle(TenantsDueFor $tenants, TenantContext $tenant, Clock $clock): int
    {
        $before = $clock->now()->modify('-5 minutes')->format('Y-m-d H:i:s.uP');
        $queued = 0;
        foreach ($tenants('attachment_scan') as $tenantId) {
            /** @var list<array{string, string}> $due */
            $due = $tenant->run($tenantId, fn (): array => Attachment::query()
                ->where('scan_status', 'pending')->whereNotNull('completed_at')
                ->whereRaw('coalesce(scan_checked_at, completed_at) < ?', [$before])
                ->orderBy('completed_at')->limit(self::BATCH)->get(['id', 'company_id'])
                ->map(fn (Attachment $a): array => [$a->company_id, $a->id])->all());

            foreach ($due as [$companyId, $id]) {
                // Dispatched outside the tenant context: a tenant-aware job refuses to start inside one when run synchronously.
                $this->dispatch($tenantId, $companyId, $id);
                $queued++;
            }
        }
        if ($queued > 0) {
            $this->info("Queued {$queued} scan(s).");
        }

        return self::SUCCESS;
    }

    private function dispatch(string $tenantId, string $companyId, string $id): void
    {
        ScanAttachment::dispatch($tenantId, $companyId, $id);
    }
}
