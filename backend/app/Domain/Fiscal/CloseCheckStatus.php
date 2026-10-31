<?php

declare(strict_types=1);

namespace App\Domain\Fiscal;

enum CloseCheckStatus: string
{
    case Pass = 'pass';
    case Fail = 'fail';
    case Waived = 'waived';
}
