<?php

declare(strict_types=1);

namespace App\Domain\Fiscal;

enum PeriodKind: string
{
    case Regular = 'regular';
    /** 13th period for closing and audit adjustments (13 §23 D7). */
    case Adjustment = 'adjustment';
}
