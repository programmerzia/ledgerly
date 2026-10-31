<?php

declare(strict_types=1);

namespace App\Support\Idempotency;

use App\Contracts\IdGenerator;
use Illuminate\Database\Connection;
use Illuminate\Database\DatabaseManager;
use LogicException;

/**
 * The idempotency protocol of 13 §11; the database row is the lock.
 *
 *   claim()     short transaction before the request runs: insert `pending` with a lease, or
 *               decide what an existing row means (reuse, in progress, replay, takeover).
 *   commit()    inside the Action's UnitOfWork transaction: `pending → committed` with the
 *               subject, atomically with the business change.
 *   complete()  after a 2xx or 422 response: store it for replay.
 *   release()   after any other response: delete the row, but only while it is still `pending`.
 *               A committed change is never released, so a retry cannot apply it twice.
 *
 * Lease times use the database clock, so web nodes with drifting clocks agree on expiry.
 */
final class IdempotencyStore
{
    public const int LEASE_SECONDS = 120;

    public function __construct(private readonly DatabaseManager $db, private readonly IdGenerator $ids) {}

    public function claim(IdempotencyScope $scope, string $requestHash): Claim
    {
        $db = $this->connection();
        if ($db->transactionLevel() > 0) {
            throw new LogicException('An idempotency claim must commit on its own, before the request runs.');
        }

        return $db->transaction(function () use ($db, $scope, $requestHash): Claim {
            $id = $this->ids->next();
            $inserted = $db->selectOne(
                'INSERT INTO idempotency_keys (id, tenant_id, actor_type, actor_id, key, request_hash, state, lease_until) '
                ."VALUES (?, ?, ?, ?, ?, ?, 'pending', now() + make_interval(secs => ?)) "
                .'ON CONFLICT (tenant_id, actor_type, actor_id, key) DO NOTHING RETURNING id',
                [$id, $scope->tenantId, $scope->actorType, $scope->actorId, $scope->key, $requestHash, self::LEASE_SECONDS],
            );
            if ($inserted !== null) {
                return new Claim(ClaimOutcome::Execute, $id);
            }

            $row = $db->selectOne(
                'SELECT id, request_hash, state, lease_until > now() AS leased, subject_type, subject_id, response_status, response_body '
                .'FROM idempotency_keys WHERE tenant_id = ? AND actor_type = ? AND actor_id = ? AND key = ? FOR UPDATE',
                [$scope->tenantId, $scope->actorType, $scope->actorId, $scope->key],
            );
            if ($row === null) {
                // Purged between the insert and the read; the caller may simply retry.
                return new Claim(ClaimOutcome::InProgress, $id);
            }
            $existing = (string) $row->id;

            if (! hash_equals((string) $row->request_hash, $requestHash)) {
                return new Claim(ClaimOutcome::Reused, $existing);
            }

            return match ($row->state) {
                'completed' => new Claim(ClaimOutcome::Replay, $existing, (int) $row->response_status, $row->response_body),
                'committed' => new Claim(ClaimOutcome::ReplayCurrent, $existing, subjectType: $row->subject_type, subjectId: $row->subject_id),
                default => $row->leased ? new Claim(ClaimOutcome::InProgress, $existing) : $this->takeOver($db, $existing),
            };
        });
    }

    /**
     * Marks the key committed with the subject the request changed. Call it inside the business
     * transaction; it changes nothing when the key is not pending (already committed, or unclaimed).
     */
    public function commit(Connection $db, IdempotencyScope $scope, ?string $subjectType, ?string $subjectId): void
    {
        $db->update(
            "UPDATE idempotency_keys SET state = 'committed', subject_type = ?, subject_id = ? "
            ."WHERE tenant_id = ? AND actor_type = ? AND actor_id = ? AND key = ? AND state = 'pending'",
            [$subjectType, $subjectId, $scope->tenantId, $scope->actorType, $scope->actorId, $scope->key],
        );
    }

    public function complete(string $id, int $status, string $body): void
    {
        $this->connection()->update(
            "UPDATE idempotency_keys SET state = 'completed', response_status = ?, response_body = ? WHERE id = ? AND state <> 'completed'",
            [$status, $body, $id],
        );
    }

    public function release(string $id): void
    {
        $this->connection()->delete("DELETE FROM idempotency_keys WHERE id = ? AND state = 'pending'", [$id]);
    }

    private function takeOver(Connection $db, string $id): Claim
    {
        $db->update('UPDATE idempotency_keys SET lease_until = now() + make_interval(secs => ?) WHERE id = ?', [self::LEASE_SECONDS, $id]);

        return new Claim(ClaimOutcome::Execute, $id);
    }

    private function connection(): Connection
    {
        return $this->db->connection();
    }
}
