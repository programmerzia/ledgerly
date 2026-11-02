<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Actions\Procurement\Inputs\OrderDraftInput;
use App\Http\Requests\CompanyRequest;
use App\Http\Requests\Concerns\ShapesOrderLines;
use DateTimeImmutable;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Validation\Rule;

/**
 * Create (POST) or replace (PUT, with `version`) a draft purchase order. Shape only; the server prices the lines,
 * ignores any totals sent, and the Action decides whether the supplier, currency and tax codes fit.
 */
final class PurchaseOrderRequest extends CompanyRequest
{
    use ShapesOrderLines;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'contact_id' => ['required', 'uuid', $this->inCompany('contacts')->whereNull('deleted_at')],
            'order_date' => ['required', 'date_format:Y-m-d'],
            'expected_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:order_date'],
            'currency' => ['nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'fx_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
            ...$this->orderLineRules(),
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [fn (Validator $validator) => $this->checkOrderLines($validator)];
    }

    public function toInput(): OrderDraftInput
    {
        $v = $this->validated();

        return new OrderDraftInput(
            companyId: $this->company()->id,
            contactId: (string) $v['contact_id'],
            orderDate: new DateTimeImmutable((string) $v['order_date']),
            lines: $this->orderLineInputs(),
            expectedDate: isset($v['expected_date']) ? new DateTimeImmutable((string) $v['expected_date']) : null,
            currency: isset($v['currency']) ? (string) $v['currency'] : null,
            fxRate: isset($v['fx_rate']) ? (string) $v['fx_rate'] : null,
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
