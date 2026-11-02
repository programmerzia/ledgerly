<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Actions\Procurement\Inputs\BillFromOrderInput;
use App\Contracts\Clock;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;

/** Make a bill draft from an order, or from one receipt. Everything else is copied from the order; nothing is claimed until the bill is submitted. */
final class BillFromOrderRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            /** Default: today. */
            'issue_date' => ['nullable', 'date_format:Y-m-d'],
            'due_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:issue_date'],
            'fx_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'reference' => ['nullable', 'string', 'max:255'],
        ];
    }

    public function toInput(string $orderId, Clock $clock, ?string $receiptId = null): BillFromOrderInput
    {
        $v = $this->validated();

        return new BillFromOrderInput(
            orderId: $orderId,
            issueDate: isset($v['issue_date']) ? new DateTimeImmutable((string) $v['issue_date']) : DateTimeImmutable::createFromInterface($clock->now())->setTime(0, 0),
            receiptId: $receiptId,
            dueDate: isset($v['due_date']) ? new DateTimeImmutable((string) $v['due_date']) : null,
            fxRate: isset($v['fx_rate']) ? (string) $v['fx_rate'] : null,
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
        );
    }
}
