<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Contracts\Clock;
use App\Domain\Procurement\RequisitionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\PurchaseRequisition;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** The last approval has been given (or no workflow applies): the requisition gets its gapless number. Posts nothing (D14). */
final class FinalizeRequisition
{
    public function __construct(private readonly UnitOfWork $uow, private readonly Clock $clock) {}

    public function handle(Actor $actor, string $requisitionId): PurchaseRequisition
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($requisitionId) {
            $requisition = $locks->document(PurchaseRequisition::query()->findOrFail($requisitionId));
            if (! in_array($requisition->status, [RequisitionStatus::Draft, RequisitionStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$requisition->status->value} requisition cannot be approved.");
            }
            $year = $requisition->requisition_date->format('Y');
            $number = $locks->sequence($requisition->company_id, "doc:purchase_requisition:{$year}", "PR-{$year}-");

            $before = $requisition->attributesToArray();
            $requisition->forceFill([
                'status' => RequisitionStatus::Approved, 'number' => $number, 'approved_at' => $this->clock->now(), 'lock_version' => $requisition->lock_version + 1,
            ])->save();

            $audit->add('purchase_requisition.approved', $requisition, before: $before, after: $requisition, context: ['number' => $number]);
            $outbox->add(new ProcurementEvent('purchase_requisition.approved', $requisition->id, $requisition->company_id, $requisition->lock_version, ['number' => $number]));

            return $requisition;
        });
    }
}
