<?php

declare(strict_types=1);

namespace App\Services\Banking;

use App\Contracts\PeriodCloseCheck;
use App\Domain\Fiscal\CheckOutcome;
use App\Models\Banking\BankStatementLine;
use App\Models\Fiscal\FiscalPeriod;

/** BANK_REC: no imported statement line dated in the period is still unmatched (excluded lines are a decision, not a gap). */
final class BankReconciliationCheck implements PeriodCloseCheck
{
    public function code(): string
    {
        return 'BANK_REC';
    }

    public function run(FiscalPeriod $period): CheckOutcome
    {
        if ($period->kind !== 'regular') {
            return new CheckOutcome($this->code(), true, 'The adjustment period has no bank statements.');
        }
        $rows = BankStatementLine::query()->where('company_id', $period->company_id)->where('status', 'unmatched')
            ->whereBetween('txn_date', [$period->starts_on->format('Y-m-d'), $period->ends_on->format('Y-m-d')])
            ->selectRaw('bank_account_id, count(*) as n')->groupBy('bank_account_id')->pluck('n', 'bank_account_id')->all();
        $total = (int) array_sum($rows);

        return new CheckOutcome(
            $this->code(), $total === 0,
            $total === 0 ? 'Every bank statement line in the period is matched.' : "{$total} bank statement line(s) in the period are not reconciled.",
            ['unmatched_lines' => $total, 'by_bank_account' => array_map('intval', $rows)],
        );
    }
}
