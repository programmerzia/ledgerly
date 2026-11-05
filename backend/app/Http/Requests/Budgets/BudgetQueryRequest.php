<?php

declare(strict_types=1);

namespace App\Http\Requests\Budgets;

use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/**
 * The query string of the budget reads: the list (`fiscal_year_id`), the spread (`total`, whole minor units), the grid suggestions
 * (`source` budget|actuals with `budget_id` or `fiscal_year_id`) and the export (`format`). Which of them a route uses is up to the route.
 */
final class BudgetQueryRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'fiscal_year_id' => ['nullable', 'uuid', $this->inCompany('fiscal_years')],
            'total' => ['nullable', 'integer', 'between:-999999999999999,999999999999999'],
            'source' => ['nullable', 'string', Rule::in(['budget', 'actuals'])],
            'budget_id' => ['nullable', 'uuid', $this->inCompany('budgets')],
            'format' => ['nullable', 'string', Rule::in(['csv', 'xlsx'])],
        ];
    }

    public function fiscalYearId(): ?string
    {
        $v = $this->validated()['fiscal_year_id'] ?? null;

        return $v === null ? null : (string) $v;
    }

    public function total(): ?int
    {
        $v = $this->validated()['total'] ?? null;

        return $v === null ? null : (int) $v;
    }

    public function source(): ?string
    {
        $v = $this->validated()['source'] ?? null;

        return $v === null ? null : (string) $v;
    }

    public function budgetId(): ?string
    {
        $v = $this->validated()['budget_id'] ?? null;

        return $v === null ? null : (string) $v;
    }

    public function exportFormat(): string
    {
        return (string) ($this->validated()['format'] ?? 'csv');
    }
}
