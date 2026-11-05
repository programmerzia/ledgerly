<?php

declare(strict_types=1);

namespace App\Http\Requests\Budgets;

use App\Http\Requests\CompanyRequest;
use App\Services\Budgets\BudgetLineWriter;

/**
 * Cells of the grid: `{version, cells: [{account_id, fiscal_period_id, dimensions?: {dimensionId: valueId}, amount}]}`. Amounts are whole minor
 * units of the base currency, in the account's own direction; 0 clears the cell. The Action checks accounts, periods and dimension values.
 */
final class BudgetLinesRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'version' => ['required', 'integer', 'min:0'],
            'cells' => ['required', 'array', 'min:1', 'max:'.BudgetLineWriter::MAX_CELLS],
            'cells.*.account_id' => ['required', 'uuid'],
            'cells.*.fiscal_period_id' => ['required', 'uuid'],
            'cells.*.dimensions' => ['nullable', 'array', 'max:8'],
            'cells.*.dimensions.*' => ['uuid'],
            'cells.*.amount' => ['required', 'integer', 'between:-'.BudgetLineWriter::MAX_AMOUNT.','.BudgetLineWriter::MAX_AMOUNT],
        ];
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }

    /** @return list<array{account_id: string, fiscal_period_id: string, dimensions?: array<string, string>, amount: int}> */
    public function cells(): array
    {
        $out = [];
        /** @var list<array<string, mixed>> $cells */
        $cells = $this->validated()['cells'];
        foreach ($cells as $c) {
            $cell = ['account_id' => (string) $c['account_id'], 'fiscal_period_id' => (string) $c['fiscal_period_id'], 'amount' => (int) $c['amount']];
            if (! empty($c['dimensions'])) {
                /** @var array<string, string> $dims */
                $dims = $c['dimensions'];
                $cell['dimensions'] = $dims;
            }
            $out[] = $cell;
        }

        return $out;
    }
}
