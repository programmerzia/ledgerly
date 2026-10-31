<?php

declare(strict_types=1);

namespace App\Domain\Fiscal;

enum PeriodStatus: string
{
    case Open = 'open';
    case SoftClosed = 'soft_closed';
    case Closed = 'closed';
    case Locked = 'locked';
}
