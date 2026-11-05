<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use Illuminate\Support\Facades\DB;

/**
 * The chart templates a company can start from, without their lines: the picker needs the size,
 * not the accounts. Templates are global reference data, so no tenant context is involved.
 */
final class ListChartTemplates
{
    /** @return list<ChartTemplateSummary> */
    public function __invoke(): array
    {
        $rows = DB::table('chart_templates')
            ->select(['code', 'name', 'country', 'standard', 'is_recommended'])
            ->selectRaw('jsonb_array_length(lines) AS account_count')
            ->orderBy('name')
            ->get();

        return array_values($rows->map(fn (object $row) => new ChartTemplateSummary(
            (string) $row->code,
            (string) $row->name,
            $row->country === null ? null : (string) $row->country,
            (string) $row->standard,
            (int) $row->account_count,
            (bool) $row->is_recommended,
        ))->all());
    }
}
