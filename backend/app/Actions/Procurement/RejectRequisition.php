<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Contracts\Clock;
use App\Contracts\PermissionChecker;
use App\Domain\Procurement\RequisitionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Workflow\ApprovalRequest;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** An approver turns a requisition down for good, with a reason. Returning it (to draft, to be changed) is `ReturnDocument`. */
final class RejectRequisition
{
    public function __construct(private readonly UnitOfWork $uow, private readonly PermissionChecker $permissions, private readonly Clock $clock) {}

    public function handle(Actor $actor, string $requisitionId, ?int $lockVersion, string $reason): PurchaseRequisition
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reject a requisition.');
        }
        if (trim($reason) === '') {
            throw DomainRuleViolation::single('comment_required', 'Say why the requisition is rejected.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $requisitionId, $lockVersion, $reason) {
            $seen = PurchaseRequisition::query()->findOrFail($requisitionId);
            if (! $this->permissions->allows($actor, 'purchase_requisitions.approve', $seen->company_id)) {
                throw DomainRuleViolation::single('forbidden', 'You cannot review requisitions in this company.');
            }
            $requisition = $locks->document($seen, $lockVersion);
            if ($requisition->status !== RequisitionStatus::PendingApproval) {
                throw DomainRuleViolation::single('document_not_pending', "A {$requisition->status->value} requisition is not waiting for approval.");
            }
            if (in_array($actor->id, [$requisition->created_by, $requisition->submitted_by], true)) {
                throw DomainRuleViolation::single('self_approval_forbidden', 'You created or submitted this requisition, so someone else has to decide on it.');
            }

            $now = $this->clock->now();
            $first = true;
            foreach (ApprovalRequest::query()->where('document_type', 'purchase_requisition')->where('document_id', $requisition->id)
                ->where('status', 'pending')->orderBy('step')->orderBy('slot')->lockForUpdate()->get() as $request) {
                $request->forceFill($first
                    ? ['status' => 'returned', 'decided_by' => $actor->id, 'decided_at' => $now, 'comment' => $reason]
                    : ['status' => 'cancelled'])->save();
                $first = false;
            }

            $before = $requisition->attributesToArray();
            $requisition->forceFill(['status' => RequisitionStatus::Rejected, 'rejection_reason' => $reason, 'lock_version' => $requisition->lock_version + 1])->save();

            $audit->add('purchase_requisition.rejected', $requisition, before: $before, after: $requisition, context: ['reason' => $reason]);
            $outbox->add(new ProcurementEvent('purchase_requisition.rejected', $requisition->id, $requisition->company_id, $requisition->lock_version, ['reason' => $reason]));

            return $requisition;
        });
    }
}
