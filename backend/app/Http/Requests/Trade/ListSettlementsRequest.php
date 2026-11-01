<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Http\Requests\CompanyRequest;
use App\Services\Trade\SettlementWriter;
use Illuminate\Validation\Rule;

/** Filters of GET /settlements: `kind`, `status`, `contact_id`, `from|to` (settlement date), `search` (number, reference); paging is CursorPage's. */
final class ListSettlementsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['nullable', 'string', Rule::in(SettlementWriter::KINDS)],
            'status' => ['nullable', 'string', Rule::in(['draft', 'pending_approval', 'posted', 'reversed', 'void'])],
            'contact_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
            'search' => ['nullable', 'string', 'max:100'],
        ];
    }
}
