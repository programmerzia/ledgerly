<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Http\Requests\CompanyRequest;

final class VoidJournalRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['nullable', 'string', 'max:2000'],
            'version' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function reason(): ?string
    {
        $v = $this->validated();

        return isset($v['reason']) ? trim((string) $v['reason']) : null;
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }
}
