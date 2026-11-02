<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

enum GoodsReceiptStatus: string
{
    case Recorded = 'recorded';
    case Reversed = 'reversed';
}
