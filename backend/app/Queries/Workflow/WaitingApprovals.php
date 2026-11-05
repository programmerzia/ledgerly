<?php

declare(strict_types=1);

namespace App\Queries\Workflow;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/**
 * What the approval reminders need to read and claim (plan 3c.7): the documents whose workflow asks for reminders, when the
 * current step opened, and the unique claim per (document, step, interval).
 */
final class WaitingApprovals
{
    public function __construct(private readonly Clock $clock, private readonly IdGenerator $ids) {}

    /** @return list<array{type: string, id: string, hours: int}> documents with a pending step whose workflow has a reminder time */
    public function withReminders(string $companyId): array
    {
        $rows = DB::select(
            "SELECT r.document_type, r.document_id, MAX(w.remind_after_hours) AS hours
             FROM approval_requests r JOIN approval_workflows w ON w.id = r.workflow_id
             WHERE r.company_id = ? AND r.status = 'pending' AND w.remind_after_hours IS NOT NULL
             GROUP BY r.document_type, r.document_id",
            [$companyId],
        );

        return array_values(array_map(function (object $r): array {
            $row = (array) $r;

            return ['type' => (string) $row['document_type'], 'id' => (string) $row['document_id'], 'hours' => (int) $row['hours']];
        }, $rows));
    }

    /** When the current step opened: the last approval of this submission, or the submission itself for the first step. */
    public function stepOpenedAt(string $type, string $id): DateTimeImmutable
    {
        $row = DB::selectOne(
            "SELECT MIN(requested_at) AS requested, (SELECT MAX(d.decided_at) FROM approval_requests d WHERE d.document_type = ? AND d.document_id = ?
                AND d.status = 'approved' AND d.requested_at = (SELECT MIN(p.requested_at) FROM approval_requests p WHERE p.document_type = ? AND p.document_id = ? AND p.status = 'pending')) AS approved
             FROM approval_requests WHERE document_type = ? AND document_id = ? AND status = 'pending'",
            [$type, $id, $type, $id, $type, $id],
        );

        return new DateTimeImmutable((string) ($row->approved ?? $row->requested));
    }

    /** True for the one caller that wins the (document, step, interval) row. */
    public function claim(string $tenantId, string $companyId, string $type, string $id, int $step, int $interval, int $recipients): bool
    {
        return DB::affectingStatement(
            'INSERT INTO approval_reminders (id, tenant_id, company_id, document_type, document_id, step, sequence, recipients, sent_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (document_type, document_id, step, sequence) DO NOTHING',
            [$this->ids->next(), $tenantId, $companyId, $type, $id, $step, $interval, $recipients, $this->clock->now()->format('Y-m-d H:i:s.uP')],
        ) > 0;
    }
}
