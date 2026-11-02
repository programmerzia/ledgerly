<?php

declare(strict_types=1);

namespace App\Support\Outbox;

use App\Contracts\OutboxHandler;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\DatabaseManager;
use LogicException;

/**
 * Posting, settlement, approval and period events flag the tenant's practice-overview figures for refresh
 * (13 §7). Marking is one cheap, idempotent write; the figures are recomputed later by `kpi:refresh`, which
 * coalesces a burst of events into one run. No report query runs here.
 */
final class KpiOutboxHandler implements OutboxHandler
{
    /** @var list<string> */
    public const array TYPES = [
        'journal.posted', 'journal.reversed',
        'invoice.posted', 'invoice.reversed', 'bill.posted', 'bill.reversed',
        'settlement.posted', 'settlement.reversed', 'payment_run.posted', 'credit_application.created', 'credit_application.reversed',
        'document.submitted', 'document.approved', 'document.returned', 'document.voided',
        'period.soft_closed', 'period.closed', 'period.reopened', 'fiscal_year.closed', 'fiscal_year.locked',
    ];

    public function __construct(private readonly DatabaseManager $db, private readonly TenantContext $tenant) {}

    public function handle(OutboxMessage $message): void
    {
        if ($this->tenant->require() !== $message->tenantId) {
            throw new LogicException('The outbox message does not belong to the current tenant.');
        }
        $this->db->connection()->select('SELECT sysops.mark_kpi_dirty(?)', [$message->tenantId]);
    }
}
