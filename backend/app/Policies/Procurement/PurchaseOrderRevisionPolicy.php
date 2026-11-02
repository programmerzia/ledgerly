<?php

declare(strict_types=1);

namespace App\Policies\Procurement;

use App\Domain\Procurement\RevisionStatus;
use App\Models\Platform\User;
use App\Models\Procurement\PurchaseOrderRevision;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Revisions of approved orders. They follow the order's permissions (`purchase_orders.*`); a revision is approved like an order. */
final class PurchaseOrderRevisionPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function view(Authenticatable $principal, PurchaseOrderRevision $revision): bool
    {
        return $this->context->can($principal, 'purchase_orders.view', 'purchase_orders:read', $revision->company_id);
    }

    public function update(Authenticatable $principal, PurchaseOrderRevision $revision): bool
    {
        return $revision->status === RevisionStatus::Draft
            && $this->context->can($principal, 'purchase_orders.create', 'purchase_orders:write', $revision->company_id);
    }

    public function submit(Authenticatable $principal, PurchaseOrderRevision $revision): bool
    {
        return $revision->status === RevisionStatus::Draft
            && $this->context->can($principal, 'purchase_orders.submit', 'purchase_orders:submit', $revision->company_id);
    }

    public function approve(Authenticatable $principal, PurchaseOrderRevision $revision): bool
    {
        return $principal instanceof User
            && $revision->status === RevisionStatus::PendingApproval
            && ! in_array($principal->id, [$revision->created_by, $revision->submitted_by], true)
            && $this->context->allows($principal, 'purchase_orders.approve', $revision->company_id);
    }

    public function return(Authenticatable $principal, PurchaseOrderRevision $revision): bool
    {
        return $this->approve($principal, $revision);
    }

    public function void(Authenticatable $principal, PurchaseOrderRevision $revision): bool
    {
        if (! in_array($revision->status, [RevisionStatus::Draft, RevisionStatus::PendingApproval], true)) {
            return false;
        }
        $own = $revision->created_by === $principal->getAuthIdentifier();
        if (! $principal instanceof User) {
            return $own && $this->context->can($principal, 'purchase_orders.create', 'purchase_orders:write', $revision->company_id);
        }

        return $own || $this->context->allows($principal, 'purchase_orders.approve', $revision->company_id);
    }
}
