<?php

declare(strict_types=1);

namespace App\Queries\Audit;

use App\Models\Audit\AuditEvent;
use Illuminate\Database\Eloquent\Builder;

/** The company's audit events, filtered; the caller paginates (newest first, by id). */
final class ListAuditEvents
{
    /** @return Builder<AuditEvent> */
    public function __invoke(string $companyId, ?string $action = null, ?string $subjectType = null, ?string $subjectId = null, ?string $actorId = null, ?string $requestId = null): Builder
    {
        // The person's name is read by one correlated subquery (no N+1, no join to confuse the keyset columns). It only
        // resolves for user actors who are members of the event's own tenant; system and API-client events stay null.
        $query = AuditEvent::query()->select('audit_events.*')->selectRaw(
            "(SELECT u.name FROM users u JOIN tenant_users tu ON tu.user_id = u.id AND tu.tenant_id = audit_events.tenant_id WHERE u.id = audit_events.actor_id AND audit_events.actor_type IN ('user', 'admin_impersonating') LIMIT 1) AS actor_name",
        )->where('company_id', $companyId);
        if ($action !== null) {
            // `invoice` matches invoice.created, invoice.posted, …; a full action matches itself.
            $like = addcslashes($action, '\\%_');
            $query->where(fn (Builder $q) => $q->where('action', $action)->orWhere('action', 'like', $like.'.%'));
        }
        if ($subjectType !== null) {
            $query->where('subject_type', $subjectType);
        }
        if ($subjectId !== null) {
            $query->where('subject_id', $subjectId);
        }
        if ($actorId !== null) {
            $query->where('actor_id', $actorId);
        }
        if ($requestId !== null) {
            $query->where('request_id', $requestId);
        }

        return $query;
    }
}
