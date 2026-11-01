<?php

declare(strict_types=1);

namespace App\Queries\Workflow;

use App\Contracts\RoleChecker;
use App\Models\Workflow\ApprovalRequest;
use App\Support\Actor;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;

/**
 * Approvals the actor could sign right now (13 §10): per document, the next unsigned slot of the
 * current step, where the actor holds the step's role, did not create or submit the document and has not
 * signed an earlier step. One row per document. The caller paginates (oldest first, by id).
 */
final class ListApprovalInbox
{
    public function __construct(private readonly RoleChecker $roles) {}

    /** @return Builder<ApprovalRequest> */
    public function __invoke(Actor $actor, string $companyId): Builder
    {
        $pending = ApprovalRequest::query()->where('company_id', $companyId)->where('status', 'pending');
        $held = array_values(array_filter(
            $pending->clone()->distinct()->pluck('role')->all(),
            fn (string $role) => $this->roles->holds($actor, $role, $companyId),
        ));
        $me = (string) $actor->id;

        return ApprovalRequest::query()
            ->from('approval_requests')
            ->select('approval_requests.*')
            ->selectSub(
                fn (QueryBuilder $q) => $q->from('journal_lines')->selectRaw('GREATEST(COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0))')
                    ->whereColumn('journal_lines.journal_id', 'approval_requests.document_id'),
                'document_amount',
            )
            ->where('approval_requests.company_id', $companyId)
            ->where('approval_requests.status', 'pending')
            ->whereIn('approval_requests.role', $held)
            // Current step: the lowest step with a pending slot; next slot: the lowest pending slot in it.
            ->whereRaw('approval_requests.step = (SELECT MIN(p.step) FROM approval_requests p WHERE p.document_type = approval_requests.document_type AND p.document_id = approval_requests.document_id AND p.status = \'pending\')')
            ->whereRaw('approval_requests.slot = (SELECT MIN(p.slot) FROM approval_requests p WHERE p.document_type = approval_requests.document_type AND p.document_id = approval_requests.document_id AND p.step = approval_requests.step AND p.status = \'pending\')')
            ->whereExists(fn (QueryBuilder $q) => $q->from('journals')->selectRaw('1')
                ->whereColumn('journals.id', 'approval_requests.document_id')
                ->where('journals.status', 'pending_approval')
                ->whereRaw('journals.created_by IS DISTINCT FROM ?', [$me])
                ->whereRaw('journals.submitted_by IS DISTINCT FROM ?', [$me]))
            ->whereNotExists(fn (QueryBuilder $q) => $q->from('approval_requests as s')->selectRaw('1')
                ->whereColumn('s.document_id', 'approval_requests.document_id')
                ->whereColumn('s.document_type', 'approval_requests.document_type')
                ->where('s.signed_by', $me))
            ->with('journal');
    }
}
