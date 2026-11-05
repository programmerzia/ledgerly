<?php

declare(strict_types=1);

namespace App\Queries\Audit;

use App\Domain\Audit\AuditEventVerifier;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\DatabaseManager;

/**
 * Recomputes the current tenant's audit chain (13 §14). For each event, in id order (ids are
 * assigned under the head lock, so id order is chain order):
 * - `prev_hash` must be the previous event's hash (chain link: catches deleted or reordered rows);
 * - `hash` must equal sha256(prev_hash ‖ canonical) (catches edited canonical text);
 * - `canonical` must decode to the row's own columns (catches edited columns).
 * Then the head must point at the last event (catches a truncated tail) and every seal must
 * match the hash of the event it sealed.
 *
 * With `fromLastSeal`, verification starts after the newest seal that still matches its event,
 * so nightly runs cost O(new events) while a full run remains available.
 */
final class VerifyAuditChain
{
    private const int CHUNK = 1000;

    public function __construct(private readonly DatabaseManager $db, private readonly TenantContext $tenant) {}

    public function __invoke(bool $fromLastSeal = false): AuditChainReport
    {
        $tenantId = $this->tenant->require();
        $db = $this->db->connection();

        /** @var array<int, string> $seals sealed_through_id → tip hash */
        $seals = [];
        foreach ($db->select('SELECT sealed_through_id, tip_hash FROM audit_seals ORDER BY sealed_through_id') as $s) {
            $seals[(int) $s->sealed_through_id] = (string) $s->tip_hash;
        }

        [$afterId, $prev] = $fromLastSeal ? $this->lastValidSeal($seals) : [0, null];
        $startedAfter = $afterId > 0 ? $afterId : null;
        $checked = 0;
        $lastId = $afterId > 0 ? $afterId : null;

        do {
            $rows = $db->select('SELECT * FROM audit_events WHERE id > ? ORDER BY id LIMIT ?', [$afterId, self::CHUNK]);
            foreach ($rows as $row) {
                $id = (int) $row->id;
                if ($row->prev_hash !== $prev) {
                    return AuditChainReport::broken($checked, $startedAfter, $id, 'chain_link', 'prev_hash does not match the previous event; an event was removed or reordered.');
                }
                if (! AuditEventVerifier::hashMatches((array) $row, $prev)) {
                    return AuditChainReport::broken($checked, $startedAfter, $id, 'hash_mismatch', 'The stored hash does not match the canonical text.');
                }
                $field = AuditEventVerifier::columnMismatch((array) $row);
                if ($field !== null) {
                    return AuditChainReport::broken($checked, $startedAfter, $id, 'canonical_mismatch', "Column {$field} differs from the hashed canonical record.");
                }
                if (isset($seals[$id]) && ! hash_equals($seals[$id], (string) $row->hash)) {
                    return AuditChainReport::broken($checked, $startedAfter, $id, 'seal_mismatch', 'The event differs from the version that was sealed.');
                }
                $prev = (string) $row->hash;
                $lastId = $afterId = $id;
                $checked++;
            }
        } while (count($rows) === self::CHUNK);

        $head = $db->selectOne('SELECT last_id, last_hash FROM audit_chain_heads WHERE tenant_id = ?', [$tenantId]);
        $headId = $head?->last_id === null ? null : (int) $head->last_id;
        if ($headId !== $lastId || ($head->last_hash ?? null) !== $prev) {
            return AuditChainReport::broken($checked, $startedAfter, $lastId, 'head_mismatch', 'The chain head does not point at the last event; events were removed from the end.');
        }
        foreach (array_keys($seals) as $sealedId) {
            if ($lastId === null || $sealedId > $lastId) {
                return AuditChainReport::broken($checked, $startedAfter, $sealedId, 'seal_mismatch', 'A seal covers events that no longer exist.');
            }
        }

        return new AuditChainReport(true, $checked, $startedAfter);
    }

    /**
     * The newest seal whose event still carries the sealed hash; verification starts after it.
     *
     * @param  array<int, string>  $seals
     * @return array{int, string|null}
     */
    private function lastValidSeal(array $seals): array
    {
        foreach (array_reverse($seals, true) as $sealedId => $tip) {
            $hash = $this->db->connection()->selectOne('SELECT hash FROM audit_events WHERE id = ?', [$sealedId])?->hash;
            if (is_string($hash) && hash_equals($tip, $hash)) {
                return [$sealedId, $hash];
            }
        }

        return [0, null];
    }
}
