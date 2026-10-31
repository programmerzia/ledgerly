<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

enum JournalStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Posted = 'posted';
    case Reversed = 'reversed';
    case Void = 'void';

    public function isEditable(): bool
    {
        return $this === self::Draft;
    }
}
