<?php

declare(strict_types=1);

namespace App\Support\Reports\Export;

use InvalidArgumentException;

/** Flattens the wire form of each report into a ReportTable. Amounts stay `{amount, currency}` until the exporter formats them. */
final class ReportTables
{
    /**
     * @param  array<string, mixed>  $data  a report as the API answers it
     */
    public static function of(string $report, array $data, string $company, int $decimals): ReportTable
    {
        return match ($report) {
            'trial_balance' => self::trialBalance($data, $company, $decimals),
            'profit_and_loss' => self::profitAndLoss($data, $company, $decimals),
            'balance_sheet' => self::balanceSheet($data, $company, $decimals),
            'cash_flow' => self::cashFlow($data, $company, $decimals),
            default => throw new InvalidArgumentException("No table for report {$report}."),
        };
    }

    /** @param array<string, mixed> $d */
    private static function trialBalance(array $d, string $company, int $decimals): ReportTable
    {
        $rows = [];
        foreach ($d['rows'] as $r) {
            $rows[] = new ReportRow([$r['account']['code'], $r['account']['name'], $r['debit'], $r['credit']]);
        }
        $rows[] = new ReportRow(['', 'Total', $d['totals']['debit'], $d['totals']['credit']], 'grand_total');

        return new ReportTable('Trial balance', "{$company} · As of {$d['as_of']}", [
            ['label' => 'Code', 'numeric' => false], ['label' => 'Account', 'numeric' => false],
            ['label' => 'Debit', 'numeric' => true], ['label' => 'Credit', 'numeric' => true],
        ], $rows, $decimals);
    }

    /** @param array<string, mixed> $d */
    private static function profitAndLoss(array $d, string $company, int $decimals): ReportTable
    {
        $compare = ($d['comparison']['available'] ?? false) === true;
        $head = [['label' => 'Account', 'numeric' => false], ['label' => "{$d['from']} to {$d['to']}", 'numeric' => true]];
        if ($compare) {
            array_push($head, ['label' => 'Comparison', 'numeric' => true], ['label' => 'Variance', 'numeric' => true], ['label' => 'Variance %', 'numeric' => true]);
        }
        $figures = fn (array $x): array => $compare ? [$x['amount'], $x['comparison'], $x['variance'], $x['variance_pct'] === null ? '' : $x['variance_pct'].'%'] : [$x['amount']];

        $rows = [];
        foreach ($d['sections'] as $s) {
            $rows[] = new ReportRow([$s['title']], 'heading');
            foreach ($s['lines'] as $l) {
                $rows[] = new ReportRow(["{$l['account']['code']} {$l['account']['name']}", ...$figures($l)]);
            }
            $rows[] = new ReportRow(["Total {$s['title']}", ...$figures($s['total'])], 'total');
        }
        foreach (['gross_profit' => 'Gross profit', 'operating_profit' => 'Operating profit', 'net_profit' => 'Net profit'] as $k => $label) {
            $rows[] = new ReportRow([$label, ...$figures($d['subtotals'][$k])], $k === 'net_profit' ? 'grand_total' : 'total');
        }

        return new ReportTable('Profit and loss', "{$company} · {$d['from']} to {$d['to']}", $head, $rows, $decimals);
    }

    /** @param array<string, mixed> $d */
    private static function balanceSheet(array $d, string $company, int $decimals): ReportTable
    {
        $compare = ($d['comparison']['available'] ?? false) === true;
        $head = [['label' => 'Account', 'numeric' => false], ['label' => $d['as_of'], 'numeric' => true]];
        if ($compare) {
            array_push($head, ['label' => (string) $d['comparison']['as_of'], 'numeric' => true], ['label' => 'Variance', 'numeric' => true]);
        }
        $figures = fn (array $x): array => $compare ? [$x['amount'], $x['comparison'], $x['variance']] : [$x['amount']];

        $rows = [];
        foreach (['assets' => 'Assets', 'liabilities' => 'Liabilities', 'equity' => 'Equity'] as $key => $title) {
            $rows[] = new ReportRow([$title], 'heading');
            foreach ($d[$key]['lines'] as $l) {
                $name = isset($l['account']) && ! isset($l['gross']) ? "{$l['account']['code']} {$l['account']['name']}" : (string) $l['name'];
                if (isset($l['fund'])) {
                    $name .= " [{$l['fund']['name']}]";
                }
                $rows[] = new ReportRow([$name, ...$figures($l)]);
                foreach ($l['contacts'] ?? [] as $c) {
                    $rows[] = new ReportRow(['    '.($c['contact']['name'] ?? '(no contact)'), $c['amount']]);
                }
            }
            $rows[] = new ReportRow(["Total {$title}", ...$figures($d[$key]['total'])], 'total');
        }
        $rows[] = new ReportRow(['Total liabilities and equity', ...$figures($d['totals']['liabilities_and_equity'])], 'grand_total');

        return new ReportTable('Balance sheet', "{$company} · As of {$d['as_of']}", $head, $rows, $decimals);
    }

    /** @param array<string, mixed> $d */
    private static function cashFlow(array $d, string $company, int $decimals): ReportTable
    {
        $rows = [];
        foreach (['operating' => 'Operating activities', 'investing' => 'Investing activities', 'financing' => 'Financing activities'] as $key => $title) {
            $rows[] = new ReportRow([$title], 'heading');
            foreach ($d[$key]['lines'] as $l) {
                $rows[] = new ReportRow([$l['label'], $l['amount']]);
            }
            $rows[] = new ReportRow(["Cash from {$key} activities", $d[$key]['total']], 'total');
        }
        $rows[] = new ReportRow(['Effect of exchange rate changes on cash', $d['fx_effect_on_cash']]);
        $rows[] = new ReportRow(['Net change in cash', $d['net_change_in_cash']], 'total');
        $rows[] = new ReportRow(['Cash at start', $d['opening_cash']]);
        $rows[] = new ReportRow(['Cash at end', $d['closing_cash']], 'grand_total');

        return new ReportTable('Cash flow statement', "{$company} · {$d['from']} to {$d['to']}", [
            ['label' => 'Activity', 'numeric' => false], ['label' => 'Amount', 'numeric' => true],
        ], $rows, $decimals);
    }
}
