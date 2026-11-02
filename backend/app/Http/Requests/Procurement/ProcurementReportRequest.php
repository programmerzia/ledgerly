<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Contracts\Clock;
use App\Http\Requests\CompanyRequest;

/** Filters of the procurement reports: `contact_id`, and `as_of` (received-not-billed only; default today). */
final class ProcurementReportRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'contact_id' => ['nullable', 'uuid'],
            'as_of' => ['nullable', 'date_format:Y-m-d'],
        ];
    }

    public function contactId(): ?string
    {
        $v = $this->validated();

        return isset($v['contact_id']) ? (string) $v['contact_id'] : null;
    }

    public function asOf(Clock $clock): string
    {
        $v = $this->validated();

        return isset($v['as_of']) ? (string) $v['as_of'] : $clock->now()->format('Y-m-d');
    }
}
