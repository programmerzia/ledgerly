<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Filters of GET /payment-runs (`status`) and GET /wht-certificates (`contact_id`, `status`, `from|to`). */
final class ListPaymentRunsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'status' => ['nullable', 'string', Rule::in(['draft', 'pending_approval', 'posted', 'reversed', 'void', 'issued'])],
            'contact_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d'],
        ];
    }
}
