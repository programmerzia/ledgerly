<?php

declare(strict_types=1);

namespace App\Services\Budgets;

use App\Models\Budgets\Budget;
use App\Models\Organisation\Company;
use App\Queries\Budgets\BudgetGrid;
use App\Support\Reports\Export\ReportRow;
use App\Support\Reports\Export\ReportTable;
use App\Support\Reports\Export\SpoutExporter;
use Illuminate\Support\Facades\DB;

/**
 * The grid as a spreadsheet: one row per account (and per dimension combination), one column per period, and a total. CSV or XLSX through
 * the same exporter the reports use, so formula-injection escaping is the same. The CSV can be edited and brought back through the
 * `budget_lines` import (long format) or pasted into the grid.
 */
final class BudgetExport
{
    public const array FORMATS = ['csv' => 'text/csv; charset=UTF-8', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

    public function __construct(private readonly BudgetGrid $grid, private readonly SpoutExporter $spout) {}

    public function table(Budget $budget, Company $company): ReportTable
    {
        $data = ($this->grid)($budget);
        $cur = $company->base_currency;
        $decimals = (int) (DB::table('currencies')->where('code', $cur)->value('minor_unit') ?? 2);
        $accounts = DB::table('accounts')->where('company_id', $budget->company_id)->get(['id', 'code', 'name'])->keyBy('id');
        $values = DB::table('dimension_values')->join('dimensions', 'dimensions.id', '=', 'dimension_values.dimension_id')
            ->where('dimension_values.company_id', $budget->company_id)->get(['dimension_values.id as id', 'dimensions.code as dimension', 'dimension_values.code as code'])->keyBy('id');

        $rows = [];
        foreach ($data['lines'] as $line) {
            $dims = array_map(fn (string $v) => ($values[$v]->dimension ?? '?').'='.($values[$v]->code ?? '?'), array_values((array) $line['dimensions']));
            sort($dims);
            $key = $line['account_id'].'|'.implode(';', $dims);
            $rows[$key] ??= ['account' => $accounts[$line['account_id']] ?? null, 'dimensions' => implode('; ', $dims), 'amounts' => []];
            $rows[$key]['amounts'][$line['fiscal_period_id']] = $line['amount'];
        }
        usort($rows, fn (array $a, array $b) => [$a['account']->code ?? '', $a['dimensions']] <=> [$b['account']->code ?? '', $b['dimensions']]);

        $out = [];
        $grand = array_fill_keys(array_column($data['periods'], 'id'), 0);
        foreach ($rows as $r) {
            $cells = [$r['account']->code ?? '', $r['account']->name ?? '', $r['dimensions']];
            $total = 0;
            foreach ($data['periods'] as $p) {
                $amount = $r['amounts'][$p['id']] ?? 0;
                $grand[$p['id']] += $amount;
                $total += $amount;
                $cells[] = ['amount' => $amount, 'currency' => $cur];
            }
            $cells[] = ['amount' => $total, 'currency' => $cur];
            $out[] = new ReportRow($cells);
        }
        $totals = ['', 'Total', ''];
        foreach ($data['periods'] as $p) {
            $totals[] = ['amount' => $grand[$p['id']], 'currency' => $cur];
        }
        $totals[] = ['amount' => array_sum($grand), 'currency' => $cur];
        $out[] = new ReportRow($totals, 'grand_total');

        $columns = [['label' => 'Code', 'numeric' => false], ['label' => 'Account', 'numeric' => false], ['label' => 'Dimensions', 'numeric' => false]];
        foreach ($data['periods'] as $p) {
            $columns[] = ['label' => $p['name'], 'numeric' => true];
        }
        $columns[] = ['label' => 'Total', 'numeric' => true];

        return new ReportTable('Budget', "{$company->name} · {$budget->name} (version {$budget->version}, {$budget->status})", $columns, $out, $decimals);
    }

    public function write(ReportTable $table, string $format, string $path): void
    {
        $this->spout->write($table, $format, $path);
    }
}
