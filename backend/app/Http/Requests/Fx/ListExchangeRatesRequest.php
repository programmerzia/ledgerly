<?php

declare(strict_types=1);

namespace App\Http\Requests\Fx;

use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Filters of GET /fx-rates: `from`, `to` (currency codes), `source`, `date_from`, `date_to`; paging is CursorPage's. */
final class ListExchangeRatesRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'from' => ['nullable', 'string', 'regex:/^[A-Z]{3}$/'],
            'to' => ['nullable', 'string', 'regex:/^[A-Z]{3}$/'],
            'source' => ['nullable', 'string', Rule::in(['manual', 'provider', 'document'])],
            'date_from' => ['nullable', 'date_format:Y-m-d'],
            'date_to' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    public function filter(string $key): ?string
    {
        $v = $this->validated();

        return isset($v[$key]) ? (string) $v[$key] : null;
    }
}
