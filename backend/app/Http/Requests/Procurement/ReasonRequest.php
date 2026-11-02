<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Http\Requests\CompanyRequest;

/** A transition that must say why: reject a requisition, cancel an order, reverse a receipt. */
final class ReasonRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'max:2000'],
            'version' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function reason(): string
    {
        return trim((string) $this->validated()['reason']);
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }
}
