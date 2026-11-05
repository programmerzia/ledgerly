<?php

declare(strict_types=1);

namespace App\Http\Requests\Audit;

use App\Http\Requests\CompanyRequest;

/** Filters of GET /audit-events. */
final class ListAuditEventsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'action' => ['nullable', 'string', 'max:64', 'regex:/^[a-z_.]+$/'],
            'subject_type' => ['nullable', 'string', 'max:64', 'regex:/^[a-z_]+$/'],
            'subject_id' => ['nullable', 'uuid'],
            'actor_id' => ['nullable', 'uuid'],
            'request_id' => ['nullable', 'string', 'max:64'],
            /** UTC days, both inclusive (the audit trail report, 3c.20). */
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ];
    }

    public function filter(string $key): ?string
    {
        $v = $this->validated();

        return isset($v[$key]) ? (string) $v[$key] : null;
    }
}
