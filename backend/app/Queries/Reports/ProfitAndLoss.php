<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Domain\Reports\ProfitLossSection;
use App\Http\Support\Json;
use Illuminate\Validation\ValidationException;

/**
 * Profit and loss over a range. Amounts are in the account's own direction (income by credit, expense by
 * debit), so a section total reads as a positive figure and contra accounts come out negative. Year-end
 * closing journals are left out (D7), so the report is the same before and after the close. The adjustment
 * period's audit adjustments count in the month that ends on the same day.
 *
 * Subtotals: gross profit = revenue − cost of sales; operating profit = gross profit − operating expenses;
 * net profit = operating profit + other income − other expenses.
 *
 * With `breakdown` (3c.19) every line, section total and subtotal also carries `by_dimension`: the same figure split
 * over the values of the chosen dimension plus an untagged column, adding up to the figure without the breakdown.
 * It cannot be combined with a comparison.
 */
final class ProfitAndLoss
{
    public function __construct(private readonly LedgerBalances $balances, private readonly AccountDirectory $accounts, private readonly DimensionBreakdown $breakdown) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        if ($p->breakdownSlot !== null && $p->comparisonRange !== null) {
            throw ValidationException::withMessages(['breakdown' => ['A breakdown by dimension cannot be combined with a comparison. Choose one.']]);
        }
        $accounts = $this->accounts->all($p->companyId);
        $current = $this->amounts($p, $p->from, $p->to);
        $split = $p->breakdownSlot === null ? null : $this->split($p, $accounts);
        $columns = null;
        if ($split !== null) {
            $active = [];
            foreach ($split as $byKey) {
                foreach ($byKey as $key => $amount) {
                    if ($amount !== 0 && $key !== '') {
                        $active[] = (string) $key;
                    }
                }
            }
            $columns = $this->breakdown->columns($p, $active);
        }
        /** @var array<string, array<string, int>> $columnTotals section → column key → amount */
        $columnTotals = [];
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
            $moved = array_filter($split[$a->id] ?? [], fn (int $v): bool => $v !== 0) !== [];
            if ($p->hideZero && $amount === 0 && $before === 0 && ! $moved) {
                continue;
            }
            if (! $a->postable && $amount === 0 && $before === 0 && ! $moved) {
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
            if ($columns !== null) {
                $line['by_dimension'] = DimensionBreakdown::cells($columns['keys'], $split[$a->id] ?? [], $cur);
                foreach ($columns['keys'] as $key) {
                    $columnTotals[$section->value][$key] = ($columnTotals[$section->value][$key] ?? 0) + ($split[$a->id][$key] ?? 0);
                }
            }
            $sections[$section->value][] = $line;
        }

        $out = [];
        foreach (ProfitLossSection::cases() as $section) {
            $total = $this->figure($totals[$section->value], $prevTotals[$section->value], $compare, $cur);
            if ($columns !== null) {
                $total['by_dimension'] = DimensionBreakdown::cells($columns['keys'], $columnTotals[$section->value] ?? [], $cur);
            }
            $out[] = [
                'key' => $section->value,
                'title' => $section->title(),
                'lines' => $sections[$section->value],
                'total' => $total,
            ];
        }

        $sub = fn (callable $f): array => [$f($totals), $f($prevTotals)];
        [$gross, $grossPrev] = $sub(fn (array $t) => $t['operating_revenue'] - $t['direct_costs']);
        [$operating, $operatingPrev] = $sub(fn (array $t) => $t['operating_revenue'] - $t['direct_costs'] - $t['operating_expense']);
        [$net, $netPrev] = $sub(fn (array $t) => $t['operating_revenue'] - $t['direct_costs'] - $t['operating_expense'] + $t['other_income'] - $t['other_expense']);

        $subtotals = [
            'gross_profit' => $this->figure($gross, $grossPrev, $compare, $cur),
            'operating_profit' => $this->figure($operating, $operatingPrev, $compare, $cur),
            'net_profit' => $this->figure($net, $netPrev, $compare, $cur),
        ];
        if ($columns !== null) {
            $col = fn (string $section, string $key): int => $columnTotals[$section][$key] ?? 0;
            foreach ($columns['keys'] as $i => $key) {
                $g = $col('operating_revenue', $key) - $col('direct_costs', $key);
                $o = $g - $col('operating_expense', $key);
                $n = $o + $col('other_income', $key) - $col('other_expense', $key);
                foreach (['gross_profit' => $g, 'operating_profit' => $o, 'net_profit' => $n] as $name => $value) {
                    $subtotals[$name]['by_dimension'][$i] = Json::money($value, $cur);
                }
            }
        }

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
            'subtotals' => $subtotals,
            'filtered' => $p->dims !== [],
        ] + ($columns === null ? [] : ['breakdown' => ['dimension' => $columns['dimension'], 'columns' => $columns['columns']]]);
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

    /**
     * Net movement per income/expense account and column of the breakdown dimension ('' = untagged), in the account's
     * own direction, closing journals excluded.
     *
     * @param  array<string, AccountInfo>  $accounts
     * @return array<string, array<string, int>>
     */
    private function split(ReportParams $p, array $accounts): array
    {
        $ids = array_keys(array_filter($accounts, fn (AccountInfo $a) => in_array($a->type, ['income', 'expense'], true)));
        $out = [];
        foreach ($this->balances->totals($p->companyId, $p->from, $p->to, true, $p->dims, $p->breakdownSlot, accountIds: $ids === [] ? null : $ids) as $row) {
            $a = $accounts[$row->accountId] ?? null;
            if ($a !== null && in_array($a->type, ['income', 'expense'], true)) {
                $key = $row->group ?? '';
                $out[$a->id][$key] = ($out[$a->id][$key] ?? 0) + $a->natural($row->debit, $row->credit);
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
