<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Http\Requests\CompanyRequest;

/** Create (code and name) or rename (PUT: name and the `version` it was based on) a dimension. */
final class DimensionRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'code' => [$update ? 'prohibited' : 'required', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function code(): string
    {
        return trim((string) $this->validated()['code']);
    }

    public function name(): string
    {
        return trim((string) $this->validated()['name']);
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
