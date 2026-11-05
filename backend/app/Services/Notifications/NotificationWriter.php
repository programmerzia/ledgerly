<?php

declare(strict_types=1);

namespace App\Services\Notifications;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use Illuminate\Database\DatabaseManager;

/**
 * Stores drafts. `ON CONFLICT (user_id, dedupe_key) DO NOTHING` is the idempotency: a message relayed twice, or a reminder
 * run twice, leaves one row per person. Returns the user ids that got a new row, so a caller can tell who was really notified.
 * A person who is no longer a user of the tenant's companies cannot be notified: the foreign keys reject unknown users, so
 * those are filtered out first.
 */
final class NotificationWriter
{
    public function __construct(private readonly DatabaseManager $db, private readonly Clock $clock, private readonly IdGenerator $ids) {}

    /**
     * @param  list<NotificationDraft>  $drafts
     * @return list<string> user ids newly notified
     */
    public function store(string $tenantId, array $drafts): array
    {
        $new = [];
        $db = $this->db->connection();
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        foreach ($drafts as $d) {
            $inserted = $db->affectingStatement(
                'INSERT INTO user_notifications (id, tenant_id, company_id, user_id, kind, title, body, subject_type, subject_id, link, dedupe_key, created_at)
                 SELECT ?, ?, ?, u.id, ?, ?, ?, ?, ?, ?, ?, ? FROM users u WHERE u.id = ?
                 ON CONFLICT (user_id, dedupe_key) DO NOTHING',
                [$this->ids->next(), $tenantId, $d->companyId, $d->kind, $d->title, $d->body, $d->subjectType, $d->subjectId, $d->link, $d->dedupeKey, $now, $d->userId],
            );
            if ($inserted > 0) {
                $new[] = $d->userId;
            }
        }

        return $new;
    }
}
