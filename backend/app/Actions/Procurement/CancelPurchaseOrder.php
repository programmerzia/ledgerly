<?php

declare(strict_types=1);

namespace App\Actions\Procurement;

use App\Contracts\Clock;
use App\Contracts\PermissionChecker;
use App\Domain\Procurement\PurchaseOrderStatus;
use App\Domain\Procurement\RevisionStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Procurement\ProcurementEvent;
use App\Models\Procurement\PurchaseOrder;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Models\Workflow\ApprovalRequest;
use App\Queries\Procurement\OrderLineFigures;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Cancels an order nothing has happened to. The creator may cancel their own draft or pending order; beyond that it takes
 * `purchase_orders.cancel`. An approved order keeps its number, so numbers stay gapless, and frees its requisition lines.
 */
final class CancelPurchaseOrder
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PermissionChecker $permissions,
        private readonly OrderLineFigures $figures,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $orderId, ?int $lockVersion, string $reason): PurchaseOrder
    {
        if ($actor->type !== ActorType::User || $actor->id === null) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can cancel an order.');
        }
        if (trim($reason) === '') {
            throw DomainRuleViolation::single('comment_required', 'Say why the order is cancelled.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $orderId, $lockVersion, $reason) {
            $seen = PurchaseOrder::query()->findOrFail($orderId);
            $order = $locks->document($seen, $lockVersion);
            $own = $order->created_by === $actor->id && $order->status !== PurchaseOrderStatus::Approved;
            if (! $own && ! $this->permissions->allows($actor, 'purchase_orders.cancel', $order->company_id)) {
                throw DomainRuleViolation::single('forbidden', 'You cannot cancel this order.');
            }
            if (! $order->status->canBeCancelled()) {
                throw DomainRuleViolation::single('order_not_cancellable', "A {$order->status->value} order cannot be cancelled.");
            }
            foreach ($this->figures->forOrder($order->id) as $line) {
                if ($line->isUsed()) {
                    throw DomainRuleViolation::single('order_has_activity', 'This order has receipts or bills. Reverse them first, or close the order.');
                }
            }
            if (PurchaseOrderRevision::query()->where('purchase_order_id', $order->id)->whereIn('status', [RevisionStatus::Draft->value, RevisionStatus::PendingApproval->value])->exists()) {
                throw DomainRuleViolation::single('order_has_open_revision', 'This order has a revision in progress. Void it first.');
            }

            ApprovalRequest::query()->where('document_type', 'purchase_order')->where('document_id', $order->id)->where('status', 'pending')->update(['status' => 'cancelled']);

            $before = $order->attributesToArray();
            $order->forceFill([
                'status' => PurchaseOrderStatus::Cancelled, 'cancelled_by' => $actor->id, 'cancelled_at' => $this->clock->now(), 'cancel_reason' => $reason,
                'lock_version' => $order->lock_version + 1,
            ])->save();

            $audit->add('purchase_order.cancelled', $order, before: $before, after: $order, context: ['reason' => $reason]);
            $outbox->add(new ProcurementEvent('purchase_order.cancelled', $order->id, $order->company_id, $order->lock_version, ['number' => $order->number, 'reason' => $reason]));

            return $order;
        });
    }
}
