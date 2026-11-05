<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;
use App\Support\Reports\Dates;

/**
 * Trial balance as of a date: every account's closing balance on its debit or credit side. Closing
 * journals are included, so after a year-end close the income and expense accounts read zero. Totals
 * must agree (every journal balances); `balanced` says whether they do. With a dimension filter only part
 * of each journal is selected, so the totals can legitimately differ and `filtered` is true.
 *
 * With `view=movement` or a `from` date (3c.18) the report covers a range (a period, its year to date, or from..to) instead: opening (balance at the end of the day before
 * `from`), debit and credit movement from `from` to `to`, and closing at `to`. All three include closing journals
 * (D7), exactly as the as-of report does, so the closing columns equal the as-of trial balance at `to` and
 * opening + movement = closing for every account and in total. Opening and closing are shown on the debit or
 * credit side of each account's net; movement is the gross debits and credits of the range.
 */
final class TrialBalance
{
    public function __construct(private readonly LedgerBalances $balances, private readonly AccountDirectory $accounts) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        if ($p->from !== null) {
            return $this->movement($p);
        }
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
            'mode' => 'as_of',
            'currency' => $cur,
            'as_of' => $p->to,
            'rows' => $rows,
            'totals' => ['debit' => Json::money($debits, $cur), 'credit' => Json::money($credits, $cur)],
            'balanced' => $debits === $credits,
            'filtered' => $p->dims !== [],
        ];
    }

    /** @return array<string, mixed> */
    private function movement(ReportParams $p): array
    {
        $from = (string) $p->from;
        $accounts = $this->accounts->all($p->companyId);
        $openingTo = Dates::before($from);
        $opening = [];
        foreach ($this->balances->totals($p->companyId, null, $openingTo, false, $p->dims) as $row) {
            $opening[$row->accountId] = ($opening[$row->accountId] ?? 0) + $row->debit - $row->credit;
        }
        $debit = [];
        $credit = [];
        foreach ($this->balances->totals($p->companyId, $from, $p->to, false, $p->dims) as $row) {
            $debit[$row->accountId] = ($debit[$row->accountId] ?? 0) + $row->debit;
            $credit[$row->accountId] = ($credit[$row->accountId] ?? 0) + $row->credit;
        }

        $cur = $p->currency;
        $side = fn (int $net): array => [
            'debit' => Json::money(max($net, 0), $cur),
            'credit' => Json::money(max(-$net, 0), $cur),
        ];
        $rows = [];
        $sum = ['opening_debit' => 0, 'opening_credit' => 0, 'debit' => 0, 'credit' => 0, 'closing_debit' => 0, 'closing_credit' => 0];
        foreach ($accounts as $a) {
            $open = $opening[$a->id] ?? 0;
            $dr = $debit[$a->id] ?? 0;
            $cr = $credit[$a->id] ?? 0;
            $close = $open + $dr - $cr;
            if ($open === 0 && $dr === 0 && $cr === 0 && ($p->hideZero || ! $a->postable)) {
                continue;
            }
            $sum['opening_debit'] += max($open, 0);
            $sum['opening_credit'] += max(-$open, 0);
            $sum['debit'] += $dr;
            $sum['credit'] += $cr;
            $sum['closing_debit'] += max($close, 0);
            $sum['closing_credit'] += max(-$close, 0);
            $rows[] = [
                'account' => $a->ref() + ['account_type' => $a->type, 'subtype' => $a->subtype],
                'opening' => $side($open),
                'movement' => ['debit' => Json::money($dr, $cur), 'credit' => Json::money($cr, $cur)],
                'closing' => $side($close),
                'drill' => [
                    'opening' => DrillKey::make($a->id, null, $openingTo, false, $p->dimensionIds),
                    'movement' => DrillKey::make($a->id, $from, $p->to, false, $p->dimensionIds),
                    'closing' => DrillKey::make($a->id, null, $p->to, false, $p->dimensionIds),
                ],
            ];
        }

        return [
            'report' => 'trial_balance',
            'mode' => 'movement',
            'currency' => $cur,
            'from' => $from,
            'to' => $p->to,
            'as_of' => $p->to,
            'opening_as_of' => $openingTo,
            'rows' => $rows,
            'totals' => [
                'opening' => ['debit' => Json::money($sum['opening_debit'], $cur), 'credit' => Json::money($sum['opening_credit'], $cur)],
                'movement' => ['debit' => Json::money($sum['debit'], $cur), 'credit' => Json::money($sum['credit'], $cur)],
                'closing' => ['debit' => Json::money($sum['closing_debit'], $cur), 'credit' => Json::money($sum['closing_credit'], $cur)],
            ],
            'balanced' => $sum['opening_debit'] === $sum['opening_credit'] && $sum['debit'] === $sum['credit'] && $sum['closing_debit'] === $sum['closing_credit'],
            'filtered' => $p->dims !== [],
        ];
    }
}
