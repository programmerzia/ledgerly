<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Http\Requests\CompanyRequest;

final class ReturnJournalRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'comment' => ['required', 'string', 'max:2000'],
            'version' => ['nullable', 'integer', 'min:0'],
        ];
    }

    public function comment(): string
    {
        return trim((string) $this->validated()['comment']);
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }
}
