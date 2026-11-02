<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Http\Requests\CompanyRequest;

/** The full list of rule ids in the order they should run. */
final class RuleOrderRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['ids' => ['required', 'array', 'min:1', 'max:500'], 'ids.*' => ['uuid', $this->inCompany('bank_rules')]];
    }

    /** @return list<string> */
    public function ids(): array
    {
        return array_values(array_map('strval', (array) $this->validated()['ids']));
    }
}
