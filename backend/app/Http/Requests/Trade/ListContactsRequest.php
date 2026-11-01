<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Filters of GET /contacts: `kind` (customer | supplier | both), `active`, `search`; paging is handled by CursorPage. */
final class ListContactsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['nullable', 'string', Rule::in(['customer', 'supplier', 'both'])],
            'active' => ['nullable', 'string', 'in:true,false,1,0'],
            'search' => ['nullable', 'string', 'max:100'],
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

    public function search(): ?string
    {
        $v = $this->validated();

        return isset($v['search']) ? (string) $v['search'] : null;
    }
}
