<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;

/**
 * Trial balance as of a date: every account's closing balance on its debit or credit side. Closing
 * journals are included, so after a year-end close the income and expense accounts read zero. Totals
 * must agree (every journal balances); `balanced` says whether they do. With a dimension filter only part
 * of each journal is selected, so the totals can legitimately differ and `filtered` is true.
 */
final class TrialBalance
{
    public function __construct(private readonly LedgerBalances $balances, private readonly AccountDirectory $accounts) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        $accounts = $this->accounts->all($p->companyId);
        $net = [];
        foreach ($this->balances->totals($p->companyId, null, $p->to, false, $p->dims) as $row) {
            $net[$row->accountId] = ($net[$row->accountId] ?? 0) + $row->debit - $row->credit;
        }

        $cur = $p->currency;
        $rows = [];
        $debits = 0;
        $credits = 0;
        foreach ($accounts as $a) {
            $n = $net[$a->id] ?? 0;
            if ($n === 0 && ($p->hideZero || ! $a->postable)) {
                continue;
            }
            $debit = max($n, 0);
            $credit = max(-$n, 0);
            $debits += $debit;
            $credits += $credit;
            $rows[] = [
                'account' => $a->ref() + ['account_type' => $a->type, 'subtype' => $a->subtype],
                'debit' => Json::money($debit, $cur),
                'credit' => Json::money($credit, $cur),
                'drill' => DrillKey::make($a->id, null, $p->to, false, $p->dimensionIds),
            ];
        }

        return [
            'report' => 'trial_balance',
            'currency' => $cur,
            'as_of' => $p->to,
            'rows' => $rows,
            'totals' => ['debit' => Json::money($debits, $cur), 'credit' => Json::money($credits, $cur)],
            'balanced' => $debits === $credits,
            'filtered' => $p->dims !== [],
        ];
    }
}
