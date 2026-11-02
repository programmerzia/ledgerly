<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

use App\Domain\Workflow\DocumentStatus;

/** A requisition's lifecycle (02 §7.1). */
enum RequisitionStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Approved = 'approved';
    case Rejected = 'rejected';
    case Void = 'void';

    public function documentStatus(): DocumentStatus
    {
        return match ($this) {
            self::Draft => DocumentStatus::Draft,
            self::PendingApproval => DocumentStatus::PendingApproval,
            self::Approved => DocumentStatus::Posted,
            self::Rejected, self::Void => DocumentStatus::Void,
        };
    }
}
