<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Http\Requests\CompanyRequest;

final class ExcludeLineRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['required', 'string', 'max:2000'],
            'version' => ['required', 'integer', 'min:0'],
        ];
    }

    public function reason(): string
    {
        return trim((string) $this->validated()['reason']);
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
