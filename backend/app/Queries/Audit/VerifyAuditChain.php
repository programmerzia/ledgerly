<?php

declare(strict_types=1);

namespace App\Queries\Audit;

use App\Domain\Audit\Jcs;
use App\Support\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Database\DatabaseManager;
use JsonException;
use Throwable;

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

    private const array SCALARS = [
        'tenant_id', 'company_id', 'actor_type', 'actor_id', 'action', 'subject_type', 'subject_id',
        'user_agent', 'request_id', 'prev_hash',
    ];

    private const array DOCUMENTS = ['before', 'after', 'context'];

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
                if (! hash_equals((string) $row->hash, hash('sha256', ($prev ?? '').$row->canonical))) {
                    return AuditChainReport::broken($checked, $startedAfter, $id, 'hash_mismatch', 'The stored hash does not match the canonical text.');
                }
                $field = $this->columnMismatch((array) $row);
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

    /**
     * The first column whose value differs from the canonical record, or null.
     *
     * @param  array<string, mixed>  $row
     */
    private function columnMismatch(array $row): ?string
    {
        try {
            $canonical = json_decode(self::text($row['canonical']), true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($canonical)) {
                return 'canonical';
            }
        } catch (JsonException) {
            return 'canonical';
        }

        foreach (self::SCALARS as $field) {
            if (($canonical[$field] ?? null) !== $row[$field]) {
                return $field;
            }
        }
        if (! self::sameIp($canonical['ip'] ?? null, $row['ip'])) {
            return 'ip';
        }
        try {
            $occurred = CarbonImmutable::parse(self::text($row['occurred_at']))->utc()->format('Y-m-d\TH:i:s.u\Z');
        } catch (Throwable) {
            return 'occurred_at';
        }
        if (($canonical['occurred_at'] ?? null) !== $occurred) {
            return 'occurred_at';
        }
        foreach (self::DOCUMENTS as $field) {
            try {
                $stored = $row[$field] === null ? null : json_decode(self::text($row[$field]), true, 512, JSON_THROW_ON_ERROR);
                if (Jcs::encode($stored) !== Jcs::encode($canonical[$field] ?? null)) {
                    return $field;
                }
            } catch (Throwable) {
                return $field;
            }
        }

        return null;
    }

    private static function text(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }

    /** inet output may spell an address differently from the input ("::1" vs "0:0:…:1"). */
    private static function sameIp(mixed $canonical, mixed $stored): bool
    {
        if ($canonical === null || $stored === null) {
            return $canonical === $stored;
        }

        return @inet_pton(self::text($canonical)) === @inet_pton(self::text($stored));
    }
}
