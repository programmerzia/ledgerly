<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

use App\Domain\Workflow\DocumentStatus;

/** An order revision's lifecycle (02 §7.1). */
enum RevisionStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Applied = 'applied';
    case Void = 'void';

    public function documentStatus(): DocumentStatus
    {
        return match ($this) {
            self::Draft => DocumentStatus::Draft,
            self::PendingApproval => DocumentStatus::PendingApproval,
            self::Applied => DocumentStatus::Posted,
            self::Void => DocumentStatus::Void,
        };
    }
}
