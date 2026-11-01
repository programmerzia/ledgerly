<?php

declare(strict_types=1);

namespace App\Http\Requests\Fiscal;

use App\Http\Requests\CompanyRequest;

/** A required free-text explanation: `reason` for a reopen request, `comment` for rejecting one. */
final class ReasonRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'reason' => ['required_without:comment', 'nullable', 'string', 'max:2000'],
            'comment' => ['required_without:reason', 'nullable', 'string', 'max:2000'],
        ];
    }

    public function text(): string
    {
        $v = $this->validated();

        return trim((string) ($v['reason'] ?? $v['comment'] ?? ''));
    }
}
