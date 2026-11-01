<?php

declare(strict_types=1);

namespace App\Http\Requests\Tax;

use App\Actions\Tax\Inputs\TaxGroupInput;
use App\Http\Requests\CompanyRequest;

/** Create (POST) and replace (PUT: name and items, with the `version` it was based on) a tax group. Items are in sequence. */
final class TaxGroupRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'code' => [$update ? 'prohibited' : 'required', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'items' => ['required', 'array', 'min:1', 'max:10'],
            'items.*.tax_code_id' => ['required', 'uuid', $this->inCompany('tax_codes')],
            'items.*.compound' => ['nullable', 'boolean'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(?string $code = null): TaxGroupInput
    {
        $v = $this->validated();

        return new TaxGroupInput(
            $this->company()->id,
            trim((string) ($v['code'] ?? $code ?? '')),
            trim((string) $v['name']),
            array_map(fn (array $i): array => ['tax_code_id' => (string) $i['tax_code_id'], 'compound' => (bool) ($i['compound'] ?? false)], array_values($v['items'])),
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
