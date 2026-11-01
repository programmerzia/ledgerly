<?php

declare(strict_types=1);

namespace App\Http\Requests\Tax;

use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Filters of GET /tax-codes: `kind` and `active`. */
final class ListTaxCodesRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['nullable', 'string', Rule::in(TaxCodeRequest::KINDS)],
            'active' => ['nullable', 'string', 'in:true,false,1,0'],
        ];
    }

    public function kind(): ?string
    {
        $v = $this->validated();

        return isset($v['kind']) ? (string) $v['kind'] : null;
    }

    public function active(): ?bool
    {
        return $this->filled('active') ? $this->boolean('active') : null;
    }
}
