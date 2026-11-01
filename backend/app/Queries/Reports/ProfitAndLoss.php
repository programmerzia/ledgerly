<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Domain\Reports\ProfitLossSection;
use App\Http\Support\Json;

/**
 * Profit and loss over a range. Amounts are in the account's own direction (income by credit, expense by
 * debit), so a section total reads as a positive figure and contra accounts come out negative. Year-end
 * closing journals are left out (D7), so the report is the same before and after the close. The adjustment
 * period's audit adjustments count in the month that ends on the same day.
 *
 * Subtotals: gross profit = revenue − cost of sales; operating profit = gross profit − operating expenses;
 * net profit = operating profit + other income − other expenses.
 */
final class ProfitAndLoss
{
    public function __construct(private readonly LedgerBalances $balances, private readonly AccountDirectory $accounts) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        $accounts = $this->accounts->all($p->companyId);
        $current = $this->amounts($p, $p->from, $p->to);
        $previous = $p->comparisonRange === null ? [] : $this->amounts($p, $p->comparisonRange['from'], $p->comparisonRange['to']);
        $compare = $p->comparisonRange !== null;
        $cur = $p->currency;

        $sections = [];
        $totals = [];
        $prevTotals = [];
        foreach (ProfitLossSection::cases() as $section) {
            $sections[$section->value] = [];
            $totals[$section->value] = 0;
            $prevTotals[$section->value] = 0;
        }
        foreach ($accounts as $a) {
            $section = ProfitLossSection::of($a->type, $a->subtype);
            if ($section === null) {
                continue;
            }
            $amount = $current[$a->id] ?? 0;
            $before = $previous[$a->id] ?? 0;
            if ($p->hideZero && $amount === 0 && $before === 0) {
                continue;
            }
            if (! $a->postable && $amount === 0 && $before === 0) {
                continue;
            }
            $totals[$section->value] += $amount;
            $prevTotals[$section->value] += $before;
            $line = [
                'account' => $a->ref() + ['subtype' => $a->subtype],
                'amount' => Json::money($amount, $cur),
                'drill' => DrillKey::make($a->id, $p->from, $p->to, true, $p->dimensionIds),
            ];
            if ($compare) {
                $line += Variance::of($amount, $before, $cur);
            }
            $sections[$section->value][] = $line;
        }

        $out = [];
        foreach (ProfitLossSection::cases() as $section) {
            $out[] = [
                'key' => $section->value,
                'title' => $section->title(),
                'lines' => $sections[$section->value],
                'total' => $this->figure($totals[$section->value], $prevTotals[$section->value], $compare, $cur),
            ];
        }

        $sub = fn (callable $f): array => [$f($totals), $f($prevTotals)];
        [$gross, $grossPrev] = $sub(fn (array $t) => $t['operating_revenue'] - $t['direct_costs']);
        [$operating, $operatingPrev] = $sub(fn (array $t) => $t['operating_revenue'] - $t['direct_costs'] - $t['operating_expense']);
        [$net, $netPrev] = $sub(fn (array $t) => $t['operating_revenue'] - $t['direct_costs'] - $t['operating_expense'] + $t['other_income'] - $t['other_expense']);

        return [
            'report' => 'profit_and_loss',
            'currency' => $cur,
            'from' => $p->from,
            'to' => $p->to,
            'basis' => $p->basis,
            'comparison' => $p->comparison === 'none' ? null : [
                'type' => $p->comparison,
                'available' => $compare,
                'from' => $p->comparisonRange['from'] ?? null,
                'to' => $p->comparisonRange['to'] ?? null,
            ],
            'sections' => $out,
            'subtotals' => [
                'gross_profit' => $this->figure($gross, $grossPrev, $compare, $cur),
                'operating_profit' => $this->figure($operating, $operatingPrev, $compare, $cur),
                'net_profit' => $this->figure($net, $netPrev, $compare, $cur),
            ],
            'filtered' => $p->dims !== [],
        ];
    }

    /**
     * Net movement per income/expense account, in the account's own direction, closing journals excluded.
     *
     * @return array<string, int>
     */
    public function amounts(ReportParams $p, ?string $from, string $to): array
    {
        $accounts = $this->accounts->all($p->companyId);
        $ids = array_keys(array_filter($accounts, fn (AccountInfo $a) => in_array($a->type, ['income', 'expense'], true)));
        $out = [];
        foreach ($this->balances->totals($p->companyId, $from, $to, true, $p->dims, accountIds: $ids === [] ? null : $ids) as $row) {
            $a = $accounts[$row->accountId] ?? null;
            if ($a !== null && in_array($a->type, ['income', 'expense'], true)) {
                $out[$a->id] = ($out[$a->id] ?? 0) + $a->natural($row->debit, $row->credit);
            }
        }

        return $out;
    }

    /** @return array<string, mixed> */
    private function figure(int $amount, int $previous, bool $compare, string $currency): array
    {
        return ['amount' => Json::money($amount, $currency)] + ($compare ? Variance::of($amount, $previous, $currency) : []);
    }
}
