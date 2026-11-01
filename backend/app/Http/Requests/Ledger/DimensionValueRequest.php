<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Http\Requests\CompanyRequest;

/** Create (code, name, optional parent value) or rename (PUT: name and `version`) a dimension value. */
final class DimensionValueRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'code' => [$update ? 'prohibited' : 'required', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'parent_id' => [$update ? 'prohibited' : 'nullable', 'uuid', $this->inCompany('dimension_values')],
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

    public function parentId(): ?string
    {
        $v = $this->validated();

        return isset($v['parent_id']) ? (string) $v['parent_id'] : null;
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
