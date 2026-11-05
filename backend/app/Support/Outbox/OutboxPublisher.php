<?php

declare(strict_types=1);

namespace App\Support\Outbox;

use App\Contracts\OutboxEvent;
use App\Jobs\Outbox\RelayOutboxMessages;
use App\Support\Tenancy\TenantContext;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\OutboxWriter;
use Illuminate\Database\DatabaseManager;
use Throwable;

/**
 * Writes one outbox message from a job that has no business change of its own to commit (a finished export, a failed send)
 * and kicks the relay. Runs inside the tenant context. A failure here is reported and never breaks the job: the bell is
 * a convenience, the export or the send log is the record.
 */
final class OutboxPublisher
{
    public function __construct(private readonly DatabaseManager $db, private readonly TenantContext $tenant, private readonly OutboxWriter $writer) {}

    public function publish(OutboxEvent $event): void
    {
        try {
            $tenantId = $this->tenant->require();
            $outbox = new Outbox;
            $outbox->add($event);
            $ids = $this->writer->write($this->db->connection(), $tenantId, $outbox);
            RelayOutboxMessages::dispatch($tenantId, $ids);
        } catch (Throwable $e) {
            report($e);
        }
    }
}
