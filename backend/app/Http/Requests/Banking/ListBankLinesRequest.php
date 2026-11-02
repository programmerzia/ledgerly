<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Filters of GET …/lines: `status`, `statement_id`, `from`, `to`, `search`; paging is CursorPage's. */
final class ListBankLinesRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'status' => ['nullable', 'string', Rule::in(['unmatched', 'matched', 'excluded'])],
            'statement_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'search' => ['nullable', 'string', 'max:100'],
        ];
    }

    /** @return array{status?: string|null, statement_id?: string|null, from?: string|null, to?: string|null, search?: string|null} */
    public function filters(): array
    {
        /** @var array{status?: string|null, statement_id?: string|null, from?: string|null, to?: string|null, search?: string|null} $v */
        $v = $this->validated();

        return $v;
    }
}
