<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Domain\Fiscal\CheckOutcome;
use App\Models\Fiscal\FiscalPeriod;

/**
 * One item of the close checklist. Each module registers its own check in `config/period_close.php`
 * (drafts and approvals now; bank reconciliation, FX revaluation and depreciation with their modules).
 * Checks read inside the closing transaction, after the period's FOR UPDATE.
 */
interface PeriodCloseCheck
{
    public function code(): string;

    public function run(FiscalPeriod $period): CheckOutcome;
}
