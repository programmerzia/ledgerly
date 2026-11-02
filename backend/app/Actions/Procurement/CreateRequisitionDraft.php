<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\RequisitionDraftInput;
use App\Contracts\IdGenerator;
use App\Domain\Procurement\RequisitionStatus;
use App\Models\Procurement\PurchaseRequisition;
use App\Services\Procurement\RequisitionWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Saves a requisition as a draft. The estimate is in the company's base currency; it has no number until it is approved. */
final class CreateRequisitionDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly RequisitionWriter $writer,
    ) {}

    public function handle(Actor $actor, RequisitionDraftInput $in): PurchaseRequisition
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'purchase_requisitions.create', $in->companyId, tokens: true);
            $computed = $this->writer->compute($in);

            $requisition = new PurchaseRequisition;
            $requisition->forceFill([
                'id' => $in->id ?? $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                'status' => RequisitionStatus::Draft, ...$this->writer->header($in, $computed), 'created_by' => $actor->id, 'lock_version' => 0,
            ])->save();
            $this->writer->insertLines($actor, $requisition, $in, $computed);

            $audit->add('purchase_requisition.created', $requisition, after: $requisition, context: ['lines' => count($in->lines)]);

            return $requisition;
        });
    }
}
