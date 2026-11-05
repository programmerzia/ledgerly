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
            // Base-currency amount: a journal's lines, or the invoice or bill's total.
            ->selectRaw("CASE WHEN approval_requests.document_type = 'journal'
                THEN (SELECT GREATEST(COALESCE(SUM(l.debit), 0), COALESCE(SUM(l.credit), 0)) FROM journal_lines l WHERE l.journal_id = approval_requests.document_id)
                WHEN approval_requests.document_type = 'settlement' THEN (SELECT s.amount FROM settlements s WHERE s.id = approval_requests.document_id)
                WHEN approval_requests.document_type = 'payment_run' THEN (SELECT r.total FROM payment_runs r WHERE r.id = approval_requests.document_id)
                WHEN approval_requests.document_type = 'fund_transfer' THEN (SELECT f.send_base FROM fund_transfers f WHERE f.id = approval_requests.document_id)
                WHEN approval_requests.document_type = 'purchase_requisition' THEN (SELECT q.total FROM purchase_requisitions q WHERE q.id = approval_requests.document_id)
                WHEN approval_requests.document_type = 'purchase_order' THEN (SELECT o.total FROM purchase_orders o WHERE o.id = approval_requests.document_id)
                WHEN approval_requests.document_type = 'purchase_order_revision' THEN (SELECT v.total FROM purchase_order_revisions v WHERE v.id = approval_requests.document_id)
                ELSE (SELECT i.total FROM invoices i WHERE i.id = approval_requests.document_id) END AS document_amount")
            ->where('approval_requests.company_id', $companyId)
            ->where('approval_requests.status', 'pending')
            ->whereIn('approval_requests.role', $held)
            // Current step: the lowest step with a pending slot; next slot: the lowest pending slot in it.
            ->whereRaw('approval_requests.step = (SELECT MIN(p.step) FROM approval_requests p WHERE p.document_type = approval_requests.document_type AND p.document_id = approval_requests.document_id AND p.status = \'pending\')')
            ->whereRaw('approval_requests.slot = (SELECT MIN(p.slot) FROM approval_requests p WHERE p.document_type = approval_requests.document_type AND p.document_id = approval_requests.document_id AND p.step = approval_requests.step AND p.status = \'pending\')')
            // Waiting for approval, and neither created nor submitted by the actor (maker ≠ checker).
            ->where(fn (Builder $any) => $any
                ->whereExists(fn (QueryBuilder $q) => $q->from('journals')->selectRaw('1')
                    ->whereColumn('journals.id', 'approval_requests.document_id')
                    ->where('journals.status', 'pending_approval')
                    ->whereRaw('journals.created_by IS DISTINCT FROM ?', [$me])
                    ->whereRaw('journals.submitted_by IS DISTINCT FROM ?', [$me]))
                ->orWhereExists(fn (QueryBuilder $q) => $q->from('invoices')->selectRaw('1')
                    ->whereColumn('invoices.id', 'approval_requests.document_id')
                    ->where('invoices.status', 'pending_approval')
                    ->whereRaw('invoices.created_by IS DISTINCT FROM ?', [$me])
                    ->whereRaw('invoices.submitted_by IS DISTINCT FROM ?', [$me]))
                ->orWhereExists(fn (QueryBuilder $q) => $q->from('settlements')->selectRaw('1')
                    ->whereColumn('settlements.id', 'approval_requests.document_id')
                    ->where('settlements.status', 'pending_approval')
                    ->whereRaw('settlements.created_by IS DISTINCT FROM ?', [$me])
                    ->whereRaw('settlements.submitted_by IS DISTINCT FROM ?', [$me]))
                ->orWhereExists(fn (QueryBuilder $q) => $q->from('payment_runs')->selectRaw('1')
                    ->whereColumn('payment_runs.id', 'approval_requests.document_id')
                    ->where('payment_runs.status', 'pending_approval')
                    ->whereRaw('payment_runs.created_by IS DISTINCT FROM ?', [$me])
                    ->whereRaw('payment_runs.submitted_by IS DISTINCT FROM ?', [$me]))
                ->orWhereExists(fn (QueryBuilder $q) => $this->waiting($q, 'fund_transfers', $me))
                ->orWhereExists(fn (QueryBuilder $q) => $this->waiting($q, 'purchase_requisitions', $me))
                ->orWhereExists(fn (QueryBuilder $q) => $this->waiting($q, 'purchase_orders', $me))
                ->orWhereExists(fn (QueryBuilder $q) => $this->waiting($q, 'purchase_order_revisions', $me)))
            ->whereNotExists(fn (QueryBuilder $q) => $q->from('approval_requests as s')->selectRaw('1')
                ->whereColumn('s.document_id', 'approval_requests.document_id')
                ->whereColumn('s.document_type', 'approval_requests.document_type')
                ->where('s.signed_by', $me))
            ->with(['journal', 'invoice', 'settlement', 'paymentRun', 'fundTransfer', 'purchaseRequisition', 'purchaseOrder', 'orderRevision.order', 'requester:id,name']);
    }

    private function waiting(QueryBuilder $q, string $table, string $me): QueryBuilder
    {
        return $q->from($table)->selectRaw('1')
            ->whereColumn("{$table}.id", 'approval_requests.document_id')
            ->where("{$table}.status", 'pending_approval')
            ->where(fn (QueryBuilder $w) => $w->whereNull("{$table}.created_by")->orWhere("{$table}.created_by", '<>', $me))
            ->where(fn (QueryBuilder $w) => $w->whereNull("{$table}.submitted_by")->orWhere("{$table}.submitted_by", '<>', $me));
    }
}
