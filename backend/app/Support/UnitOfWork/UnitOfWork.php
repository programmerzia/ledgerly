<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use App\Services\Ledger\SequenceAllocator;
use App\Support\Actor;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;
use Illuminate\Database\QueryException;
use LogicException;
use PDOException;
use Throwable;

/**
 * The single place where transactions, retries, the audit flush and the outbox live (13 §8).
 * Actions never call DB::transaction.
 */
final class UnitOfWork
{
    private const array RETRYABLE = ['40001', '40P01'];

    private int $depth = 0;

    private ?LockSet $locks = null;

    private ?AuditBuffer $audit = null;

    private ?Outbox $outbox = null;

    /** @var list<Closure(): void> */
    private array $afterCommit = [];

    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly SequenceAllocator $sequences,
        private readonly AuditWriter $auditWriter,
        private readonly OutboxWriter $outboxWriter,
        private readonly bool $strictLockOrder = true,
        private readonly int $maxAttempts = 3,
    ) {}

    /**
     * @template T
     *
     * @param  Closure(LockSet, AuditBuffer, Outbox): T  $work
     * @return T
     */
    public function run(Actor $actor, Closure $work): mixed
    {
        if ($this->depth > 0) {
            // Nested Action: share the outer transaction's locks and buffers; no retry, no flush.
            assert($this->locks !== null && $this->audit !== null && $this->outbox !== null);
            $this->depth++;
            try {
                return $work($this->locks, $this->audit, $this->outbox);
            } finally {
                $this->depth--;
            }
        }

        $tenantId = $this->tenant->require();
        if ($actor->tenantId !== $tenantId) {
            throw new LogicException('Actor tenant does not match the tenant context.');
        }

        $connection = $this->db->connection();
        // Only a top-level transaction can be retried; inside an outer one we cannot replay it.
        $attempts = $connection->transactionLevel() === 0 ? $this->maxAttempts : 1;

        for ($attempt = 1; ; $attempt++) {
            try {
                $result = $this->attempt($connection, $tenantId, $actor, $work);
            } catch (QueryException|PDOException|RetryUnitOfWork $e) {
                // Deferred constraints and commit-time conflicts surface as a bare PDOException.
                $retryable = $e instanceof RetryUnitOfWork || in_array($e->getCode(), self::RETRYABLE, true);
                if ($attempt >= $attempts || ! $retryable) {
                    throw $e;
                }
                usleep(random_int(5_000, 25_000) * $attempt);

                continue;
            }

            $this->runAfterCommit();

            return $result;
        }
    }

    /** Register a callback to run after the outermost transaction commits. */
    public function afterCommit(Closure $callback): void
    {
        if ($this->depth === 0) {
            throw new LogicException('afterCommit() needs an active UnitOfWork.');
        }
        $this->afterCommit[] = $callback;
    }

    public function active(): bool
    {
        return $this->depth > 0;
    }

    /**
     * @template T
     *
     * @param  Closure(LockSet, AuditBuffer, Outbox): T  $work
     * @return T
     */
    private function attempt(Connection $connection, string $tenantId, Actor $actor, Closure $work): mixed
    {
        $locks = $this->locks = new LockSet($connection, $this->sequences, $tenantId, $this->strictLockOrder);
        $audit = $this->audit = new AuditBuffer;
        $outbox = $this->outbox = new Outbox;
        $this->afterCommit = [];
        $this->depth = 1;

        try {
            return $connection->transaction(function () use ($connection, $tenantId, $actor, $work, $locks, $audit, $outbox) {
                $result = $work($locks, $audit, $outbox);

                // Pre-commit, in lock order: outbox rows, then the audit head (last lock).
                $this->outboxWriter->write($connection, $tenantId, $outbox);
                $this->auditWriter->flush($connection, $locks, $tenantId, $actor, $audit);

                return $result;
            }, 1);
        } catch (Throwable $e) {
            $this->afterCommit = [];

            throw $e;
        } finally {
            $this->depth = 0;
            $this->locks = null;
            $this->audit = null;
            $this->outbox = null;
        }
    }

    private function runAfterCommit(): void
    {
        $callbacks = $this->afterCommit;
        $this->afterCommit = [];
        foreach ($callbacks as $callback) {
            try {
                $callback();
            } catch (Throwable $e) {
                report($e);
            }
        }
    }
}
