<?php

declare(strict_types=1);

namespace App\Support\UnitOfWork;

use App\Contracts\Clock;
use App\Domain\Audit\Jcs;
use App\Support\Actor;
use DateTimeZone;
use Illuminate\Database\Connection;
use LogicException;

/**
 * Writes buffered audit events under the tenant's chain head (13 §14):
 * canonical = JCS(fields), hash = sha256(prev_hash ‖ canonical). The head row is the last lock.
 *
 * `flush()` runs inside the UnitOfWork transaction; `append()` is the chain step itself and is
 * also used by `DetachedAudit` on its own connection. Callers of `append()` must hold a transaction.
 */
final class AuditWriter
{
    public function __construct(private readonly Clock $clock) {}

    public function flush(Connection $db, LockSet $locks, string $tenantId, Actor $actor, AuditBuffer $buffer): void
    {
        if ($buffer->events() === []) {
            return;
        }
        $locks->enterAuditHead();
        $this->append($db, $tenantId, $actor, $buffer->events());
    }

    /**
     * Chains $events onto the tenant's head on $db, which must be inside a transaction.
     *
     * @param  list<array{action: string, company_id: string|null, subject_type: string|null, subject_id: string|null, before: mixed, after: mixed, context: mixed}>  $events
     */
    public function append(Connection $db, string $tenantId, Actor $actor, array $events): void
    {
        if ($events === []) {
            return;
        }
        if ($db->transactionLevel() === 0) {
            throw new LogicException('Audit events must be appended inside a transaction.');
        }

        $db->statement('INSERT INTO audit_chain_heads (tenant_id) VALUES (?) ON CONFLICT (tenant_id) DO NOTHING', [$tenantId]);
        /** @var object{last_id: int|null, last_hash: string|null} $head */
        $head = $db->selectOne('SELECT last_id, last_hash FROM audit_chain_heads WHERE tenant_id = ? FOR UPDATE', [$tenantId]);

        $prevHash = $head->last_hash;
        $lastId = $head->last_id;
        $occurredAt = $this->clock->now()->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.u\Z');

        foreach ($events as $event) {
            $fields = [
                'tenant_id' => $tenantId,
                'company_id' => $event['company_id'] ?? $actor->companyId,
                'actor_type' => $actor->type->value,
                'actor_id' => $actor->id,
                'action' => $event['action'],
                'subject_type' => $event['subject_type'],
                'subject_id' => $event['subject_id'],
                'before' => $event['before'],
                'after' => $event['after'],
                'context' => $event['context'],
                'ip' => $actor->ip,
                'user_agent' => $actor->userAgent,
                'request_id' => $actor->requestId,
                'occurred_at' => $occurredAt,
                'prev_hash' => $prevHash,
            ];
            $canonical = Jcs::encode($fields);
            $hash = hash('sha256', ($prevHash ?? '').$canonical);

            /** @var object{id: int} $row */
            $row = $db->selectOne(
                'INSERT INTO audit_events (tenant_id, company_id, actor_type, actor_id, action, subject_type, subject_id, '
                .'before, after, context, ip, user_agent, request_id, occurred_at, canonical, prev_hash, hash) '
                .'VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
                [
                    $tenantId, $fields['company_id'], $fields['actor_type'], $fields['actor_id'], $fields['action'],
                    $fields['subject_type'], $fields['subject_id'],
                    self::json($fields['before']), self::json($fields['after']), self::json($fields['context']),
                    $fields['ip'], $fields['user_agent'], $fields['request_id'], $occurredAt, $canonical, $prevHash, $hash,
                ],
            );

            $prevHash = $hash;
            $lastId = $row->id;
        }

        $db->update('UPDATE audit_chain_heads SET last_id = ?, last_hash = ? WHERE tenant_id = ?', [$lastId, $prevHash, $tenantId]);
    }

    private static function json(mixed $value): ?string
    {
        return $value === null ? null : Jcs::encode($value);
    }
}
