<?php

declare(strict_types=1);

namespace App\Support\Signing;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Support\Audit\DetachedAudit;
use App\Support\Tenancy\TenantContext;
use Illuminate\Database\DatabaseManager;

/**
 * `signing_events` rows (ADR-0004), written on the audit connection in their own transaction so a
 * failure is recorded even though the request that caused it fails.
 */
final class SigningEvents
{
    public function __construct(
        private readonly DatabaseManager $db,
        private readonly TenantContext $tenant,
        private readonly Clock $clock,
        private readonly IdGenerator $ids,
    ) {}

    public function record(string $userId, string $kind, ?string $ip, ?string $subjectType = null, ?string $subjectId = null): void
    {
        $this->db->connection(DetachedAudit::CONNECTION)->insert(
            'INSERT INTO signing_events (id, tenant_id, user_id, kind, subject_type, subject_id, ip, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$this->ids->next(), $this->tenant->require(), $userId, $kind, $subjectType, $subjectId, $ip, $this->clock->now()->format('Y-m-d H:i:s.uP')],
        );
    }
}
