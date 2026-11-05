<?php

declare(strict_types=1);

namespace App\Http\Requests\Reports;

use App\Http\Requests\CompanyRequest;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Validation\Rule;

/**
 * The query string of every report: a period or a date range, basis, comparison, dimension filter. Which
 * of them a report uses is up to the report; the rest is ignored. Ids are checked against the company in
 * ReportParamsResolver, which reads them anyway.
 */
final class ReportRequest extends CompanyRequest
{
    /** A query string carries `true`/`false` as text, which the boolean rule refuses. */
    protected function prepareForValidation(): void
    {
        foreach (['hide_zero', 'exclude_closing', 'include_lines'] as $flag) {
            $value = $this->query($flag);
            if ($value === 'true' || $value === 'false') {
                $this->merge([$flag => $value === 'true']);
            }
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'period_id' => ['nullable', 'uuid'],
            'as_of' => ['nullable', 'date_format:Y-m-d', 'prohibits:period_id'],
            'from' => ['nullable', 'date_format:Y-m-d', 'prohibits:period_id'],
            'to' => ['nullable', 'date_format:Y-m-d', 'prohibits:period_id', 'after_or_equal:from'],
            'basis' => ['nullable', 'string', Rule::in(['month', 'ytd'])],
            /** Trial balance only: `movement` adds opening, debit and credit movement and closing over the period or from..to. */
            'view' => ['nullable', 'string', Rule::in(['balances', 'movement'])],
            'comparison' => ['nullable', 'string', Rule::in(['none', 'previous_period', 'previous_year'])],
            /** Dimension id → a value id or a list of them; withValidator checks the shape. */
            'dimensions' => ['nullable', 'array', 'max:8'],
            /** Trial balance (as of) and profit and loss: a dimension id whose values become columns, plus an untagged column. */
            'breakdown' => ['nullable', 'uuid'],
            'hide_zero' => ['nullable', 'boolean'],
            'account_id' => ['nullable', 'uuid'],
            'exclude_closing' => ['nullable', 'boolean'],
            'contact_side' => ['nullable', 'string', Rule::in(['debit', 'credit'])],
            'contact_id' => ['nullable', 'uuid'],
            /** Journal list (3c.20): status, source ('none' = typed by hand), the person and in which role, lines under each journal. */
            'status' => ['nullable', 'string', Rule::in(['draft', 'pending_approval', 'posted', 'reversed', 'void'])],
            'source' => ['nullable', 'string', 'max:64'],
            'user_id' => ['nullable', 'uuid'],
            'user_role' => ['nullable', 'string', Rule::in(['created', 'submitted', 'approved', 'posted'])],
            'include_lines' => ['nullable', 'boolean'],
            /** Bank reconciliation report: the finished reconciliation. */
            'reconciliation_id' => ['nullable', 'uuid'],
            /** Audit trail (3c.20): same filters as the audit log. */
            'action' => ['nullable', 'string', 'max:64'],
            'actor_id' => ['nullable', 'uuid'],
            'subject_type' => ['nullable', 'string', 'max:64'],
            'subject_id' => ['nullable', 'uuid'],
            'format' => ['nullable', 'string', Rule::in(['xlsx', 'csv', 'pdf'])],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $v): void {
            foreach ((array) $this->input('dimensions', []) as $dimensionId => $values) {
                $ids = is_array($values) ? $values : [$values];
                $valid = preg_match('/^[0-9a-f-]{36}$/', (string) $dimensionId) === 1 && $ids !== [];
                foreach ($ids as $id) {
                    $valid = $valid && is_string($id) && preg_match('/^[0-9a-f-]{36}$/', $id) === 1;
                }
                if (! $valid) {
                    $v->errors()->add("dimensions.{$dimensionId}", 'Dimensions are filtered as dimensions[<dimension id>]=<value id>.');
                }
            }
        });
    }
}
