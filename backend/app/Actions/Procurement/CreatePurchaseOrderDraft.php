<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Procurement\Inputs\OrderDraftInput;
use App\Contracts\IdGenerator;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Models\Procurement\PurchaseOrder;
use App\Services\Procurement\OrderPricing;
use App\Services\Procurement\OrderWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Saves an order as a draft. The server prices it; it has no number until it is approved. */
final class CreatePurchaseOrderDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly OrderPricing $pricing,
        private readonly OrderWriter $writer,
    ) {}

    public function handle(Actor $actor, OrderDraftInput $in): PurchaseOrder
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'purchase_orders.create', $in->companyId, tokens: true);
            $computed = $this->pricing->compute($in);

            $order = new PurchaseOrder;
            $order->forceFill([
                'id' => $in->id ?? $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                'status' => PurchaseOrderStatus::Draft, ...$this->writer->header($in, $computed), 'created_by' => $actor->id, 'lock_version' => 0, 'revision' => 0,
            ])->save();
            $this->writer->insertLines($actor, $order, $in->lines, $computed);

            $audit->add('purchase_order.created', $order, after: $order, context: ['lines' => count($computed->lines)]);

            return $order;
        });
    }
}
