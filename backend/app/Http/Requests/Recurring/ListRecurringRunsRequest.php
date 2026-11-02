<?php

declare(strict_types=1);

namespace App\Http\Requests\Recurring;

use App\Http\Requests\CompanyRequest;

/** Filters of GET /recurring-runs. */
final class ListRecurringRunsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['schedule_id' => ['nullable', 'uuid']];
    }

    public function scheduleId(): ?string
    {
        $v = $this->validated();

        return isset($v['schedule_id']) ? (string) $v['schedule_id'] : null;
    }
}
