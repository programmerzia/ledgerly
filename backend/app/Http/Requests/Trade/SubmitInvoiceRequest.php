<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Http\Requests\CompanyRequest;

/** Submit an invoice: a transition, plus the reason for going past a customer's credit limit (plan 3c.12). */
final class SubmitInvoiceRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'version' => ['nullable', 'integer', 'min:0'],
            'comment' => ['nullable', 'string', 'max:2000'],
            /** Needs `invoices.override_credit_limit`, and someone who did not create or submit the invoice. Ignored when the limit holds. */
            'credit_limit_override_reason' => ['nullable', 'string', 'max:2000'],
        ];
    }

    public function version(): ?int
    {
        $v = $this->validated();

        return isset($v['version']) ? (int) $v['version'] : null;
    }

    public function creditLimitReason(): ?string
    {
        $v = $this->validated();

        return isset($v['credit_limit_override_reason']) ? trim((string) $v['credit_limit_override_reason']) : null;
    }
}
