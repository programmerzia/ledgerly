<?php

declare(strict_types=1);

namespace App\Http\Requests\Budgets;

use App\Http\Requests\CompanyRequest;

/** Create (name, fiscal year, optionally the budget to copy) or rename (PUT: name and the `version` it was based on) a budget. */
final class BudgetRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'name' => ['required', 'string', 'max:120'],
            'fiscal_year_id' => [$update ? 'prohibited' : 'required', 'uuid', $this->inCompany('fiscal_years')],
            'copy_from_budget_id' => [$update ? 'prohibited' : 'nullable', 'uuid', $this->inCompany('budgets')],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function name(): string
    {
        return trim((string) $this->validated()['name']);
    }

    public function fiscalYearId(): string
    {
        return (string) $this->validated()['fiscal_year_id'];
    }

    public function copyFrom(): ?string
    {
        $id = $this->validated()['copy_from_budget_id'] ?? null;

        return $id === null ? null : (string) $id;
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
