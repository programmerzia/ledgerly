<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Actions\Procurement\Inputs\ConvertLineInput;
use App\Actions\Procurement\Inputs\ConvertRequisitionInput;
use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use DateTimeImmutable;
use Illuminate\Validation\Rule;

/**
 * Turn lines of an approved requisition into a draft order for one supplier. A line goes whole. The estimate is in the
 * company's base currency, so an order in another currency states `unit_price_fc` on every line.
 */
final class ConvertRequisitionRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'contact_id' => ['required', 'uuid', $this->inCompany('contacts')->whereNull('deleted_at')],
            'order_date' => ['required', 'date_format:Y-m-d'],
            'expected_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:order_date'],
            'currency' => ['nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'fx_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.requisition_line_id' => ['required', 'uuid', $this->inCompany('purchase_requisition_lines')],
            /** In the order's currency. Default: the requisition's estimate, when the order is in base currency. */
            'lines.*.unit_price_fc' => ['nullable', 'integer', 'min:0', 'max:'.PostingValidator::MAX_AMOUNT],
            'lines.*.tax_code_id' => ['nullable', 'uuid', $this->inCompany('tax_codes')],
        ];
    }

    public function toInput(string $requisitionId): ConvertRequisitionInput
    {
        $v = $this->validated();

        /** @var non-empty-list<array<string, mixed>> $lines */
        $lines = array_values((array) $v['lines']);

        return new ConvertRequisitionInput(
            requisitionId: $requisitionId,
            contactId: (string) $v['contact_id'],
            orderDate: new DateTimeImmutable((string) $v['order_date']),
            lines: array_map(fn (array $line): ConvertLineInput => new ConvertLineInput(
                requisitionLineId: (string) $line['requisition_line_id'],
                unitPriceFc: isset($line['unit_price_fc']) ? (int) $line['unit_price_fc'] : null,
                taxCodeId: isset($line['tax_code_id']) ? (string) $line['tax_code_id'] : null,
                taxCodeGiven: array_key_exists('tax_code_id', $line),
            ), $lines),
            expectedDate: isset($v['expected_date']) ? new DateTimeImmutable((string) $v['expected_date']) : null,
            currency: isset($v['currency']) ? (string) $v['currency'] : null,
            fxRate: isset($v['fx_rate']) ? (string) $v['fx_rate'] : null,
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }
}
