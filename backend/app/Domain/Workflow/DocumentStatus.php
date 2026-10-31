<?php

declare(strict_types=1);

namespace App\Domain\Workflow;

/** The shared document state machine (02_AppFlow §5, 13 §10). */
enum DocumentStatus: string
{
    case Draft = 'draft';
    case PendingApproval = 'pending_approval';
    case Posted = 'posted';
    case Reversed = 'reversed';
    case Void = 'void';

    /** @return list<self> */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Draft => [self::PendingApproval, self::Posted, self::Void],
            self::PendingApproval => [self::Draft, self::Posted, self::Void],
            self::Posted => [self::Reversed],
            self::Reversed, self::Void => [],
        };
    }

    public function canBecome(self $next): bool
    {
        return in_array($next, $this->allowedTransitions(), true);
    }
}
