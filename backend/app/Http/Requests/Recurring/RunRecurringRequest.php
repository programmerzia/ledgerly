<?php

declare(strict_types=1);

namespace App\Http\Requests\Recurring;

use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/** "Run now": create every draft due up to `as_of` (default: today), optionally for one schedule. */
final class RunRecurringRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'as_of' => ['nullable', 'date_format:Y-m-d'],
            'schedule_id' => ['nullable', 'uuid'],
        ];
    }

    public function asOf(): ?DateTimeImmutable
    {
        $v = $this->validated();

        return isset($v['as_of']) ? new DateTimeImmutable((string) $v['as_of']) : null;
    }

    public function scheduleId(): ?string
    {
        $v = $this->validated();

        return isset($v['schedule_id']) ? (string) $v['schedule_id'] : null;
    }
}
