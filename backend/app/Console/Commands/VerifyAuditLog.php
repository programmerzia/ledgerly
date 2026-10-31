<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Queries\Audit\VerifyAuditChain;
use App\Support\Tenancy\TenantContext;
use Illuminate\Console\Command;

/** Recomputes one tenant's audit chain; exits 1 when it is broken (13 §14). */
final class VerifyAuditLog extends Command
{
    protected $description = 'Verify a tenant\'s audit hash chain';

    protected $signature = 'audit:verify {tenant : Tenant id} {--from-seal : Start after the newest valid seal} {--json : Print the report as JSON}';

    public function handle(TenantContext $context, VerifyAuditChain $verify): int
    {
        $tenantId = (string) $this->argument('tenant');
        if (! preg_match('/^[0-9a-f-]{36}$/i', $tenantId)) {
            $this->error('The tenant id must be a UUID.');

            return self::INVALID;
        }

        $report = $context->run($tenantId, fn () => $verify((bool) $this->option('from-seal')));

        if ($this->option('json')) {
            $this->line((string) json_encode($report->toArray(), JSON_PRETTY_PRINT));
        } elseif ($report->intact) {
            $this->info("Audit chain intact: {$report->eventsChecked} event(s) checked".($report->startedAfterId ? " after seal at event {$report->startedAfterId}." : '.'));
        } else {
            $this->error("Audit chain broken at event {$report->brokenAtId} ({$report->problem}): {$report->detail}");
        }

        return $report->intact ? self::SUCCESS : self::FAILURE;
    }
}
