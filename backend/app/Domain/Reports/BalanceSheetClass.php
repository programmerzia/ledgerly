<?php

declare(strict_types=1);

namespace App\Domain\Reports;

/** Where an asset or liability is presented on the balance sheet (IAS 1.60): current or non-current. */
enum BalanceSheetClass: string
{
    case Current = 'current';
    case NonCurrent = 'non_current';
}
