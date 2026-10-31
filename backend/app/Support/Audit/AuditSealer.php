<?php

declare(strict_types=1);

namespace App\Support\Audit;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\DatabaseManager;

/**
 * Nightly seal (13 §14): records the tenant's chain tip in `audit_seals`, so a later rewrite of
 * anything up to that tip is detectable even if the attacker recomputes every hash after it.
 * Sealing is not itself audited: that would move the tip and seal again every night.
 */
final class AuditSealer
{
    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly Clock $clock,
        private readonly IdGenerator $ids,
    ) {}

    /** @return array{id: string, sealed_through_id: int, tip_hash: string}|null null when nothing new since the last seal */
    public function seal(): ?array
    {
        $tenantId = $this->tenant->require();
        $db = $this->db->connection();

        return $db->transaction(function () use ($db, $tenantId): ?array {
            // FOR SHARE: a concurrent flush (FOR UPDATE) finishes first, so the tip is a committed one.
            $head = $db->selectOne('SELECT last_id, last_hash FROM audit_chain_heads WHERE tenant_id = ? FOR SHARE', [$tenantId]);
            if ($head === null || $head->last_id === null) {
                return null;
            }
            $lastSealed = $db->selectOne('SELECT sealed_through_id FROM audit_seals ORDER BY sealed_through_id DESC LIMIT 1');
            if ($lastSealed !== null && (int) $lastSealed->sealed_through_id >= (int) $head->last_id) {
                return null;
            }

            $seal = ['id' => $this->ids->next(), 'sealed_through_id' => (int) $head->last_id, 'tip_hash' => (string) $head->last_hash];
            $db->insert(
                'INSERT INTO audit_seals (id, tenant_id, sealed_through_id, tip_hash, sealed_at) VALUES (?, ?, ?, ?, ?)',
                [$seal['id'], $tenantId, $seal['sealed_through_id'], $seal['tip_hash'], $this->clock->now()->format('Y-m-d H:i:s.uP')],
            );

            return $seal;
        });
    }
}
