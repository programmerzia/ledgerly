<?php

declare(strict_types=1);

namespace App\Policies\Procurement;

use App\Domain\Procurement\RequisitionStatus;
use App\Models\Platform\User;
use App\Models\Procurement\PurchaseRequisition;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Purchase requisitions (`purchase_requisitions.*`, tokens `purchase_requisitions:read|write|submit`). Maker ≠ checker:
 * whoever created or submitted a requisition never approves, returns or rejects it. API clients draft and submit; the
 * rest is for people. Converting to an order needs the right to create orders.
 */
final class PurchaseRequisitionPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'purchase_requisitions.view', 'purchase_requisitions:read');
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'purchase_requisitions.create', 'purchase_requisitions:write');
    }

    public function view(Authenticatable $principal, PurchaseRequisition $requisition): bool
    {
        return $this->context->can($principal, 'purchase_requisitions.view', 'purchase_requisitions:read', $requisition->company_id);
    }

    public function update(Authenticatable $principal, PurchaseRequisition $requisition): bool
    {
        return $requisition->status === RequisitionStatus::Draft
            && $this->context->can($principal, 'purchase_requisitions.create', 'purchase_requisitions:write', $requisition->company_id);
    }

    public function submit(Authenticatable $principal, PurchaseRequisition $requisition): bool
    {
        return $requisition->status === RequisitionStatus::Draft
            && $this->context->can($principal, 'purchase_requisitions.submit', 'purchase_requisitions:submit', $requisition->company_id);
    }

    public function approve(Authenticatable $principal, PurchaseRequisition $requisition): bool
    {
        return $principal instanceof User
            && $requisition->status === RequisitionStatus::PendingApproval
            && ! in_array($principal->id, [$requisition->created_by, $requisition->submitted_by], true)
            && $this->context->allows($principal, 'purchase_requisitions.approve', $requisition->company_id);
    }

    public function return(Authenticatable $principal, PurchaseRequisition $requisition): bool
    {
        return $this->approve($principal, $requisition);
    }

    public function reject(Authenticatable $principal, PurchaseRequisition $requisition): bool
    {
        return $this->approve($principal, $requisition);
    }

    public function void(Authenticatable $principal, PurchaseRequisition $requisition): bool
    {
        if (! in_array($requisition->status, [RequisitionStatus::Draft, RequisitionStatus::PendingApproval], true)) {
            return false;
        }
        $own = $requisition->created_by === $principal->getAuthIdentifier();
        if (! $principal instanceof User) {
            return $own && $this->context->can($principal, 'purchase_requisitions.create', 'purchase_requisitions:write', $requisition->company_id);
        }

        return $own || $this->context->allows($principal, 'purchase_requisitions.approve', $requisition->company_id);
    }

    public function convert(Authenticatable $principal, PurchaseRequisition $requisition): bool
    {
        return $requisition->status === RequisitionStatus::Approved
            && $this->context->can($principal, 'purchase_orders.create', 'purchase_orders:write', $requisition->company_id);
    }
}
