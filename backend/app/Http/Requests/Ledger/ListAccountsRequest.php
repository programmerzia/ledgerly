<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Filters of GET /accounts: `type`, `active`, `search` (code or name); paging is handled by CursorPage. */
final class ListAccountsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'type' => ['nullable', 'string', Rule::in(['asset', 'liability', 'equity', 'income', 'expense'])],
            'active' => ['nullable', 'string', 'in:true,false,1,0'],
            'search' => ['nullable', 'string', 'max:100'],
        ];
    }

    public function type(): ?string
    {
        $v = $this->validated();

        return isset($v['type']) ? (string) $v['type'] : null;
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
