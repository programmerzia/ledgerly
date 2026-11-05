<?php

declare(strict_types=1);

namespace App\Http\Requests\Documents;

use App\Domain\Documents\StatementRunPeriod;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** The period of a statement run, as a date or an explicit period; a POST also names the customers. */
final class StatementRunRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $post = $this->isMethod('POST');

        return [
            /** `as_of`: the three months ending on `as_of`; `period`: exactly `from` to `to`. */
            'basis' => ['required', 'string', Rule::in(['as_of', 'period'])],
            'as_of' => ['required_if:basis,as_of', 'nullable', 'date_format:Y-m-d'],
            'from' => ['required_if:basis,period', 'nullable', 'date_format:Y-m-d'],
            'to' => ['required_if:basis,period', 'nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'contact_ids' => [$post ? 'required' : 'prohibited', 'array', 'min:1', 'max:200'],
            'contact_ids.*' => ['uuid', 'distinct'],
        ];
    }

    public function period(): StatementRunPeriod
    {
        $v = $this->validated();

        return $v['basis'] === 'as_of' ? StatementRunPeriod::asOf((string) $v['as_of']) : StatementRunPeriod::period((string) $v['from'], (string) $v['to']);
    }

    /** @return list<string> */
    public function contactIds(): array
    {
        /** @var list<string> $ids */
        $ids = $this->validated()['contact_ids'] ?? [];

        return $ids;
    }
}
