<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Domain\Reports\CashFlowActivity;
use App\Domain\Reports\CashFlowClassifier;
use App\Http\Support\Json;
use App\Support\Reports\Dates;

/**
 * Cash flow statement, indirect method (IAS 7). Cash is the accounts of control type `cash` or `bank`.
 *
 * Every other account's movement over the range lands once: profit and loss accounts as net profit,
 * balance sheet accounts by `CashFlowClassifier` (as `credit − debit`: an asset that grows uses cash, a
 * liability that grows provides it). Year-end closing journals are left out, so retained earnings shows
 * only distributions. Because each journal balances, the activities add up to the change in cash exactly;
 * `unexplained` is the difference and must be zero.
 *
 * Unrealised exchange differences on cash (revaluation journals and their reversals) are taken out of
 * operating and shown in the line the standard asks for, "effect of exchange rate changes on cash" (IAS 7.28).
 *
 * Not available with a dimension filter: part of a journal has no cash flow of its own.
 */
final class CashFlow
{
    public function __construct(private readonly LedgerBalances $balances, private readonly AccountDirectory $accounts) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        $from = (string) $p->from;
        $accounts = $this->accounts->all($p->companyId);
        $cur = $p->currency;

        $movement = [];   // account → credit − debit
        foreach ($this->balances->totals($p->companyId, $from, $p->to, true) as $row) {
            $movement[$row->accountId] = ($movement[$row->accountId] ?? 0) + $row->credit - $row->debit;
        }

        $cashAccounts = array_keys(array_filter($accounts, fn (AccountInfo $a) => $a->isCash()));
        $opening = $this->cashBalance($p->companyId, Dates::before($from), $cashAccounts);
        $closing = $this->cashBalance($p->companyId, $p->to, $cashAccounts);
        $fxEffect = 0;
        foreach ($this->balances->totals($p->companyId, $from, $p->to, true, fxOnly: true, accountIds: $cashAccounts === [] ? null : $cashAccounts) as $row) {
            $fxEffect += $row->debit - $row->credit;
        }

        $netProfit = 0;
        $groups = [];
        $assumptions = [];
        foreach (CashFlowActivity::cases() as $activity) {
            $groups[$activity->value] = [];
        }
        foreach ($accounts as $a) {
            $m = $movement[$a->id] ?? 0;
            if (in_array($a->type, ['income', 'expense'], true)) {
                $netProfit += $m;

                continue;
            }
            if ($a->isCash() || $m === 0) {
                continue;
            }
            $class = CashFlowClassifier::classify($a->type, $a->subtype, $a->controlType, $a->tags);
            $groups[$class->activity->value][] = [
                'key' => $class->nonCash ? 'non_cash' : 'account',
                'account' => $a->ref(),
                'label' => $this->label($a, $m, $class->nonCash),
                'amount' => Json::money($m, $cur),
                'drill' => DrillKey::make($a->id, $from, $p->to, true, []),
                'sort' => ($class->nonCash ? '0' : '1').$a->code,
            ];
            if ($class->assumed) {
                $assumptions[] = $a->ref() + ['activity' => $class->activity->value, 'reason' => $class->reason];
            }
        }

        $operating = [
            ['key' => 'net_profit', 'label' => 'Net profit', 'amount' => Json::money($netProfit, $cur), 'sort' => '00'],
            ...$groups['operating'],
        ];
        if ($fxEffect !== 0) {
            $operating[] = ['key' => 'unrealised_fx_on_cash', 'label' => 'Unrealised exchange differences on cash (not a cash flow)', 'amount' => Json::money(-$fxEffect, $cur), 'sort' => '05'];
        }
        $sections = [
            'operating' => $operating,
            'investing' => $groups['investing'],
            'financing' => $groups['financing'],
        ];
        $totals = [];
        $out = [];
        foreach ($sections as $name => $lines) {
            usort($lines, fn (array $x, array $y) => strcmp($x['sort'], $y['sort']));
            $lines = array_map(function (array $l): array {
                unset($l['sort']);

                return $l;
            }, $lines);
            $totals[$name] = array_sum(array_map(fn (array $l) => $l['amount']['amount'], $lines));
            $out[$name] = ['lines' => $lines, 'total' => Json::money($totals[$name], $cur)];
        }

        $actual = $closing - $opening;
        $explained = array_sum($totals) + $fxEffect;
        $unexplained = $actual - $explained;

        return [
            'report' => 'cash_flow',
            'currency' => $cur,
            'method' => 'indirect',
            'from' => $from,
            'to' => $p->to,
            'basis' => $p->basis,
            'operating' => $out['operating'],
            'investing' => $out['investing'],
            'financing' => $out['financing'],
            'fx_effect_on_cash' => Json::money($fxEffect, $cur),
            'net_change_in_cash' => Json::money($actual, $cur),
            'opening_cash' => Json::money($opening, $cur),
            'closing_cash' => Json::money($closing, $cur),
            'unexplained' => Json::money($unexplained, $cur),
            'reconciles' => $unexplained === 0,
            'assumptions' => $assumptions,
        ];
    }

    private function label(AccountInfo $a, int $movement, bool $nonCash): string
    {
        if ($nonCash) {
            return "Depreciation and amortisation ({$a->name})";
        }
        $grew = $a->type === 'asset' ? $movement < 0 : $movement > 0;

        return ($grew ? 'Increase in ' : 'Decrease in ').lcfirst($a->name);
    }

    /** @param list<string> $cashAccounts */
    private function cashBalance(string $companyId, string $asOf, array $cashAccounts): int
    {
        if ($cashAccounts === []) {
            return 0;
        }
        $sum = 0;
        foreach ($this->balances->totals($companyId, null, $asOf, false, accountIds: $cashAccounts) as $row) {
            $sum += $row->debit - $row->credit;
        }

        return $sum;
    }
}
