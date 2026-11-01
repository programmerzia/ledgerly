<?php

declare(strict_types=1);

namespace App\Domain\Reports;

/** The sections of the indirect cash flow statement (IAS 7). */
enum CashFlowActivity: string
{
    case Operating = 'operating';
    case Investing = 'investing';
    case Financing = 'financing';
}
