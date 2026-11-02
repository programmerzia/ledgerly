<?php

declare(strict_types=1);

namespace App\Policies\Procurement;

use App\Domain\Procurement\PurchaseOrderStatus;
use App\Models\Platform\User;
use App\Models\Procurement\PurchaseOrder;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Purchase orders (`purchase_orders.*`, tokens `purchase_orders:read|write|submit`). Same shape as the requisition policy.
 * Cancelling and closing are for people: the creator may cancel her own draft or pending order, `purchase_orders.cancel`
 * also an approved one. Receiving and billing ask for the receipt and bill rights. This policy also guards the
 * procurement reports (`viewAny`).
 */
final class PurchaseOrderPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'purchase_orders.view', 'purchase_orders:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'purchase_orders.create', 'purchase_orders:write');
    }

    public function view(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $this->context->can($principal, 'purchase_orders.view', 'purchase_orders:read', $order->company_id);
    }

    public function update(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $order->status === PurchaseOrderStatus::Draft
            && $this->context->can($principal, 'purchase_orders.create', 'purchase_orders:write', $order->company_id);
    }

    public function submit(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $order->status === PurchaseOrderStatus::Draft
            && $this->context->can($principal, 'purchase_orders.submit', 'purchase_orders:submit', $order->company_id);
    }

    public function approve(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $principal instanceof User
            && $order->status === PurchaseOrderStatus::PendingApproval
            && ! in_array($principal->id, [$order->created_by, $order->submitted_by], true)
            && $this->context->allows($principal, 'purchase_orders.approve', $order->company_id);
    }

    public function return(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $this->approve($principal, $order);
    }

    public function cancel(Authenticatable $principal, PurchaseOrder $order): bool
    {
        if (! $principal instanceof User) {
            return false;
        }
        $early = in_array($order->status, [PurchaseOrderStatus::Draft, PurchaseOrderStatus::PendingApproval], true);
        if ($early && $order->created_by === $principal->id) {
            return true;
        }

        return ($early || $order->status === PurchaseOrderStatus::Approved)
            && $this->context->allows($principal, 'purchase_orders.cancel', $order->company_id);
    }

    public function close(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $order->status->isOpen() && $this->context->personCan($principal, 'purchase_orders.cancel', $order->company_id);
    }

    public function revise(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $order->status->isOpen()
            && $this->context->can($principal, 'purchase_orders.create', 'purchase_orders:write', $order->company_id);
    }

    public function receive(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $order->status->isOpen()
            && $this->context->can($principal, 'goods_receipts.create', 'goods_receipts:write', $order->company_id);
    }

    public function bill(Authenticatable $principal, PurchaseOrder $order): bool
    {
        return $order->status->isOpen()
            && $this->context->can($principal, 'bills.create', 'bills:write', $order->company_id);
    }
}
