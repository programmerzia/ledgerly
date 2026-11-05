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
            'ar_aging', 'ap_aging' => self::aging($data, $company, $decimals),
            'customer_statement', 'supplier_statement' => self::statement($data, $company, $decimals),
            'tax_return' => self::taxReturn($data, $company, $decimals),
            'asset_schedule' => self::assetSchedule($data, $company, $decimals),
            default => throw new InvalidArgumentException("No table for report {$report}."),
        };
    }

    /** @param array<string, mixed> $d */
    private static function assetSchedule(array $d, string $company, int $decimals): ReportTable
    {
        $rows = [];
        $line = static fn (string $label, array $x): ReportRow => new ReportRow([
            $label, $x['cost']['opening'], $x['cost']['additions'], $x['cost']['opening_assets'], $x['cost']['disposals'], $x['cost']['revaluation'], $x['cost']['closing'],
            $x['accumulated']['opening'], $x['accumulated']['opening_assets'], $x['accumulated']['charge'], $x['accumulated']['impairment'], $x['accumulated']['disposals'],
            $x['accumulated']['revaluation'], $x['accumulated']['closing'], $x['carrying_opening'], $x['carrying_closing'],
        ], 'normal');
        foreach ($d['categories'] as $c) {
            $rows[] = new ReportRow([$c['category_name']], 'heading');
            foreach ($c['assets'] as $a) {
                $rows[] = $line("{$a['number']} {$a['name']}", $a);
            }
            $total = $line("Total {$c['category_name']}", $c);
            $rows[] = new ReportRow($total->cells, 'total');
        }
        $grand = $line('Total', $d['totals']);
        $rows[] = new ReportRow($grand->cells, 'grand_total');

        $money = ['numeric' => true];

        return new ReportTable('Fixed asset schedule', "{$company} · {$d['from']} to {$d['to']}", [
            ['label' => 'Asset', 'numeric' => false], ['label' => 'Cost: opening'] + $money, ['label' => 'Additions'] + $money, ['label' => 'Opening assets'] + $money,
            ['label' => 'Disposals'] + $money, ['label' => 'Revaluation'] + $money, ['label' => 'Cost: closing'] + $money,
            ['label' => 'Accumulated: opening'] + $money, ['label' => 'Opening assets'] + $money, ['label' => 'Charge'] + $money, ['label' => 'Impairment'] + $money,
            ['label' => 'Disposals'] + $money, ['label' => 'Revaluation'] + $money, ['label' => 'Accumulated: closing'] + $money,
            ['label' => 'Carrying: opening'] + $money, ['label' => 'Carrying: closing'] + $money,
        ], $rows, $decimals);
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

    /** @param array<string, mixed> $d */
    private static function aging(array $d, string $company, int $decimals): ReportTable
    {
        $rows = [];
        foreach ($d['rows'] as $r) {
            $rows[] = new ReportRow([$r['contact']['name'], $r['current'], $r['days_1_30'], $r['days_31_60'], $r['days_61_90'], $r['days_over_90'], $r['open'], $r['credits'], $r['net']]);
        }
        $t = $d['totals'];
        $rows[] = new ReportRow(['Total', $t['current'], $t['days_1_30'], $t['days_31_60'], $t['days_61_90'], $t['days_over_90'], $t['open'], $t['credits'], $t['net']], 'grand_total');
        if ($d['credits'] !== []) {
            $rows[] = new ReportRow(['Credits (not netted above)'], 'heading');
            foreach ($d['credits'] as $c) {
                $rows[] = new ReportRow(["{$c['contact']['name']} · {$c['number']} · {$c['date']}", null, null, null, null, null, null, $c['amount'], null]);
            }
        }
        $title = $d['report'] === 'ar_aging' ? 'Accounts receivable aging' : 'Accounts payable aging';

        return new ReportTable($title, "{$company} · As of {$d['as_of']}", [
            ['label' => 'Contact', 'numeric' => false], ['label' => 'Current', 'numeric' => true], ['label' => '1-30', 'numeric' => true],
            ['label' => '31-60', 'numeric' => true], ['label' => '61-90', 'numeric' => true], ['label' => '90+', 'numeric' => true],
            ['label' => 'Open', 'numeric' => true], ['label' => 'Credits', 'numeric' => true], ['label' => 'Net', 'numeric' => true],
        ], $rows, $decimals);
    }

    /** @param array<string, mixed> $d */
    private static function statement(array $d, string $company, int $decimals): ReportTable
    {
        $rows = [new ReportRow(['', '', 'Opening balance', null, null, $d['opening_balance']], 'heading')];
        foreach ($d['rows'] as $r) {
            $rows[] = new ReportRow([$r['date'], str_replace('_', ' ', (string) $r['type']), trim($r['document']['number'].' '.$r['description']), $r['debit'], $r['credit'], $r['balance']]);
        }
        $rows[] = new ReportRow(['', '', 'Closing balance', $d['totals']['debit'], $d['totals']['credit'], $d['closing_balance']], 'grand_total');
        $title = $d['report'] === 'customer_statement' ? 'Customer statement' : 'Supplier statement';

        return new ReportTable($title, "{$company} · {$d['contact']['code']} {$d['contact']['name']} · {$d['from']} to {$d['to']}", [
            ['label' => 'Date', 'numeric' => false], ['label' => 'Type', 'numeric' => false], ['label' => 'Document', 'numeric' => false],
            ['label' => 'Debit', 'numeric' => true], ['label' => 'Credit', 'numeric' => true], ['label' => 'Balance', 'numeric' => true],
        ], $rows, $decimals);
    }

    /** @param array<string, mixed> $d */
    private static function taxReturn(array $d, string $company, int $decimals): ReportTable
    {
        $rows = [];
        foreach (['sales' => 'Sales (output tax)', 'purchases' => 'Purchases (input tax)'] as $side => $title) {
            $rows[] = new ReportRow([$title], 'heading');
            foreach ($d[$side]['rows'] as $r) {
                $rows[] = new ReportRow([$r['tax_code'] === null ? 'No tax code' : "{$r['tax_code']['code']} {$r['tax_code']['name']}", $r['net'], $r['tax']]);
            }
            $rows[] = new ReportRow(["Total {$side}", $d[$side]['totals']['net'], $d[$side]['totals']['tax']], 'total');
        }
        $rows[] = new ReportRow(['Net tax payable', null, $d['net_tax_payable']], 'grand_total');

        return new ReportTable('Tax return', "{$company} · {$d['from']} to {$d['to']}", [
            ['label' => 'Tax code', 'numeric' => false], ['label' => 'Net amount', 'numeric' => true], ['label' => 'Tax', 'numeric' => true],
        ], $rows, $decimals);
    }
}
