<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

use App\Domain\Workflow\DocumentStatus;

/** The order's lifecycle (02 §7.1). What the workflow Actions see of it is the shared document status. */
enum PurchaseOrderStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Approved = 'approved';
    case PartlyReceived = 'partly_received';
    case Received = 'received';
    case Closed = 'closed';
    case Cancelled = 'cancelled';

    public function documentStatus(): DocumentStatus
    {
        return match ($this) {
            self::Draft => DocumentStatus::Draft,
            self::PendingApproval => DocumentStatus::PendingApproval,
            self::Approved, self::PartlyReceived, self::Received, self::Closed => DocumentStatus::Posted,
            self::Cancelled => DocumentStatus::Void,
        };
    }

    /** Approved and not finished: it can take receipts, bills and revisions, and counts as a commitment. */
    public function isOpen(): bool
    {
        return in_array($this, [self::Approved, self::PartlyReceived, self::Received], true);
    }

    public function canBeCancelled(): bool
    {
        return in_array($this, [self::Draft, self::PendingApproval, self::Approved], true);
    }

    /**
     * Where an open order stands given its lines' quantities.
     *
     * @param  list<LineFigures>  $lines
     */
    public static function fromQuantities(array $lines): self
    {
        $any = false;
        $all = $lines !== [];
        foreach ($lines as $line) {
            $any = $any || ! Quantity::isZero($line->received);
            $all = $all && Quantity::isZero($line->openToReceive());
        }

        return $all ? self::Received : ($any ? self::PartlyReceived : self::Approved);
    }
}
