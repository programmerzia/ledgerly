<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Workflow\DocumentStatus;
use DateTimeImmutable;

/**
 * The business-facing status (frontend/src/lib/docStatus.ts): "has it been paid, and is it late?". Anything not
 * posted keeps its ledger status. For posted documents the amount due is the base total less withheld tax less
 * what was settled (never negative); no amount due means paid, a due date before today means overdue.
 */
enum PaymentStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case AwaitingPayment = 'awaiting_payment';
    case PartiallyPaid = 'partially_paid';
    case Overdue = 'overdue';
    case Paid = 'paid';
    case Reversed = 'reversed';
    case Void = 'void';

    public static function of(DocumentStatus $status, int $amountDue, int $settled, DateTimeImmutable $dueDate, DateTimeImmutable $today): self
    {
        if ($status !== DocumentStatus::Posted) {
            return self::from($status->value);
        }
        if ($amountDue <= 0) {
            return self::Paid;
        }
        if ($dueDate->format('Y-m-d') < $today->format('Y-m-d')) {
            return self::Overdue;
        }

        return $settled > 0 ? self::PartiallyPaid : self::AwaitingPayment;
    }
}
