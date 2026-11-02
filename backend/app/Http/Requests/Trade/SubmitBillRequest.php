<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Http\Requests\CompanyRequest;

/** Submit a bill: a transition, plus the reason for going past a purchase order mismatch. */
final class SubmitBillRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'version' => ['nullable', 'integer', 'min:0'],
            'comment' => ['nullable', 'string', 'max:2000'],
            /** Needs `bills.match_override`. Ignored when the bill matches. */
            'match_override_reason' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }

    public function matchOverrideReason(): ?string
    {
        $v = $this->validated();

        return isset($v['match_override_reason']) ? trim((string) $v['match_override_reason']) : null;
    }
}
