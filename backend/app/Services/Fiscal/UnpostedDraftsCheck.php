<?php

declare(strict_types=1);

namespace App\Services\Fiscal;

use App\Contracts\PeriodCloseCheck;
use App\Domain\Fiscal\CheckOutcome;
use App\Models\Fiscal\FiscalPeriod;

/** DRAFTS: no draft journal dated inside the period would be stranded by the close. */
final class UnpostedDraftsCheck implements PeriodCloseCheck
{
    public function code(): string
    {
        return 'DRAFTS';
    }

    public function run(FiscalPeriod $period): CheckOutcome
    {
        $ids = PendingApprovalsCheck::inPeriod($period)->where('status', 'draft')->pluck('id')->all();

        return new CheckOutcome($this->code(), $ids === [], $ids === [] ? 'No unposted drafts.' : count($ids).' draft journal(s) are dated in this period.', ['journal_ids' => $ids]);
    }
}
