<?php

declare(strict_types=1);

namespace App\Http\Requests\Tax;

use App\Http\Requests\CompanyRequest;

/** Filter of GET /tax-groups: `active`. */
final class ListTaxGroupsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['active' => ['nullable', 'string', 'in:true,false,1,0']];
    }

    public function active(): ?bool
    {
        return $this->filled('active') ? $this->boolean('active') : null;
    }
}
