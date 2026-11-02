<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Contracts\Clock;
use App\Contracts\PermissionChecker;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Procurement\Quantity;
use App\Domain\Procurement\RevisionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Queries\Procurement\OrderLineFigures;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Closes an open order, short-closing whatever never arrived, which releases the commitment. It takes everything received
 * to be on a bill first: a closed order takes no more bills, so anything else could never be billed against it. Final.
 */
final class ClosePurchaseOrder
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PermissionChecker $permissions,
        private readonly OrderLineFigures $figures,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $orderId, ?int $lockVersion): PurchaseOrder
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can close an order.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $orderId, $lockVersion) {
            $seen = PurchaseOrder::query()->findOrFail($orderId);
            if (! $this->permissions->allows($actor, 'purchase_orders.cancel', $seen->company_id)) {
                throw DomainRuleViolation::single('forbidden', 'You cannot close this order.');
            }
            $order = $locks->document($seen, $lockVersion);
            if (! $order->status->isOpen()) {
                throw DomainRuleViolation::single('order_not_open', "A {$order->status->value} order cannot be closed.");
            }
            foreach ($this->figures->forOrder($order->id) as $line) {
                if (! Quantity::isZero($line->receivedNotBilled())) {
                    throw DomainRuleViolation::single('order_has_unbilled_receipts', 'Something received on this order is not billed yet. Bill it or reverse the receipt first.');
                }
            }
            if (PurchaseOrderRevision::query()->where('purchase_order_id', $order->id)->whereIn('status', [RevisionStatus::Draft->value, RevisionStatus::PendingApproval->value])->exists()) {
                throw DomainRuleViolation::single('order_has_open_revision', 'This order has a revision in progress. Void it first.');
            }

            $before = $order->attributesToArray();
            $order->forceFill(['status' => PurchaseOrderStatus::Closed, 'closed_by' => $actor->id, 'closed_at' => $this->clock->now(), 'lock_version' => $order->lock_version + 1])->save();

            $audit->add('purchase_order.closed', $order, before: $before, after: $order);
            $outbox->add(new ProcurementEvent('purchase_order.closed', $order->id, $order->company_id, $order->lock_version, ['number' => $order->number]));

            return $order;
        });
    }
}
