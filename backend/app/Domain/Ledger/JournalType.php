<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

enum JournalType: string
{
    case Manual = 'manual';
    case Sales = 'sales';
    case Purchase = 'purchase';
    case Receipt = 'receipt';
    case Payment = 'payment';
    case Bank = 'bank';
    case Fx = 'fx';
    case Depreciation = 'depreciation';
    case Closing = 'closing';
    case Adjustment = 'adjustment';
    case Reversal = 'reversal';
    case Opening = 'opening';

    /** Types that live only in the adjustment period (D7). */
    public function isAdjustmentPeriodType(): bool
    {
        return $this === self::Closing || $this === self::Adjustment;
    }
}
