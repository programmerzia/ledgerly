<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Http\Requests\CompanyRequest;

/** PUT /accounts/{account}/visibility: `{"hidden": true, "version": 3}`. */
final class AccountVisibilityRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'hidden' => ['required', 'boolean'],
            'version' => ['required', 'integer', 'min:0'],
        ];
    }

    public function hidden(): bool
    {
        return (bool) $this->validated()['hidden'];
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
