<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Support\Actor;
use App\Support\Tenancy\TenantContext;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\AuditWriter;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\Eloquent\Model;
use LogicException;

/**
 * Audit events that must survive a rollback (13 §14): signing failures, sensitive authorization
 * denials, read-only impersonation. Written on the `pgsql_audit` connection (same app role, same
 * tenant GUC) in its own short transaction, chained like every other event.
 *
 * Call it only after the main transaction has ended: the main transaction may hold the tenant's
 * audit head, and waiting for it from a second connection in the same process would deadlock.
 */
final class DetachedAudit
{
    public const string CONNECTION = 'pgsql_audit';

    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly AuditWriter $writer,
    ) {}

    /** @param array<string, mixed> $context */
    public function record(Actor $actor, string $action, ?Model $subject = null, array $context = []): void
    {
        if ($this->db->connection()->transactionLevel() > 0) {
            throw new LogicException('DetachedAudit::record() must run after the main transaction has ended.');
        }
        $tenantId = $this->tenant->require();
        if ($actor->tenantId !== $tenantId) {
            throw new LogicException('Actor tenant does not match the tenant context.');
        }

        $buffer = new AuditBuffer;
        $buffer->add($action, $subject, context: $context);

        $connection = $this->db->connection(self::CONNECTION);
        // Laravel retries the closure on deadlock and serialization failure.
        $connection->transaction(fn () => $this->writer->append($connection, $tenantId, $actor, $buffer->events()), 3);
    }
}
