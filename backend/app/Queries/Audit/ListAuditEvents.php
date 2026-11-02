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
        $query = AuditEvent::query()->where('company_id', $companyId);
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
