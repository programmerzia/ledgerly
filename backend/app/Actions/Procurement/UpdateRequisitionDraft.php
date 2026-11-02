<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\RequisitionDraftInput;
use App\Domain\Procurement\RequisitionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Procurement\PurchaseRequisition;
use App\Models\Procurement\PurchaseRequisitionLine;
use App\Services\Procurement\RequisitionWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Replaces a draft requisition's header and lines, guarded by lock_version. */
final class UpdateRequisitionDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly RequisitionWriter $writer,
    ) {}

    public function handle(Actor $actor, string $id, int $lockVersion, RequisitionDraftInput $in): PurchaseRequisition
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $id, $lockVersion, $in) {
            $seen = PurchaseRequisition::query()->findOrFail($id);
            $this->guard->require($actor, 'purchase_requisitions.create', $seen->company_id, tokens: true);
            $requisition = $locks->document($seen, $lockVersion);
            if ($requisition->status !== RequisitionStatus::Draft) {
                throw DomainRuleViolation::single('document_not_editable', 'Only a draft can be edited.');
            }

            $computed = $this->writer->compute($in);
            $before = $requisition->attributesToArray();
            PurchaseRequisitionLine::query()->where('purchase_requisition_id', $requisition->id)->delete();
            $requisition->forceFill([...$this->writer->header($in, $computed), 'lock_version' => $requisition->lock_version + 1])->save();
            $this->writer->insertLines($actor, $requisition, $in, $computed);

            $audit->add('purchase_requisition.updated', $requisition, before: $before, after: $requisition, context: ['lines' => count($in->lines)]);

            return $requisition;
        });
    }
}
