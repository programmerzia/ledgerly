<?php

declare(strict_types=1);

namespace App\Policies\Workflow;

use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** The approvals inbox: people who may approve documents. The inbox query narrows it to what they could sign. */
final class ApprovalRequestPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'journals.approve');
    }

    /** Anyone who may approve some kind of document; each document is checked again when it is approved. */
    public function bulkApprove(Authenticatable $principal): bool
    {
        foreach (['journals.approve', 'invoices.approve', 'bills.approve', 'payments.approve'] as $permission) {
            if ($this->context->personCan($principal, $permission)) {
                return true;
            }
        }

        return false;
    }
}
