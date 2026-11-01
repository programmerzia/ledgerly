<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Http\Requests\CompanyRequest;
use App\Queries\Ledger\JournalFilter;
use Illuminate\Validation\Rule;

/** Filters of GET /journals: status, type, from/to (journal date), period_id, search (number or reference). */
final class ListJournalsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'status' => ['nullable', 'string', Rule::enum(JournalStatus::class)],
            'type' => ['nullable', 'string', Rule::enum(JournalType::class)],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'period_id' => ['nullable', 'uuid'],
            'search' => ['nullable', 'string', 'max:100'],
        ];
    }

    public function filter(): JournalFilter
    {
        $v = $this->validated();

        return new JournalFilter(
            status: isset($v['status']) ? JournalStatus::from((string) $v['status']) : null,
            type: isset($v['type']) ? JournalType::from((string) $v['type']) : null,
            from: $v['from'] ?? null,
            to: $v['to'] ?? null,
            periodId: $v['period_id'] ?? null,
            search: $v['search'] ?? null,
        );
    }
}
