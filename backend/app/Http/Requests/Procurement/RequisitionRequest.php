<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Actions\Procurement\Inputs\RequisitionDraftInput;
use App\Actions\Procurement\Inputs\RequisitionLineInput;
use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use App\Http\Requests\Concerns\ChecksLineDimensions;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Contracts\Validation\Validator;

/**
 * Create (POST) or replace (PUT, with `version`) a draft purchase requisition. The estimate is in the company's base
 * currency; totals are the server's. A line needs an item or a description.
 */
final class RequisitionRequest extends CompanyRequest
{
    use ChecksLineDimensions;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'requisition_date' => ['required', 'date_format:Y-m-d'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.item_id' => ['nullable', 'uuid', $this->inCompany('items')],
            'lines.*.description' => ['nullable', 'string', 'max:1000'],
            'lines.*.account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'lines.*.quantity' => ['required', 'string', 'regex:/^\d{1,12}(\.\d{1,6})?$/'],
            'lines.*.estimated_unit_price' => ['required', 'integer', 'min:0', 'max:'.PostingValidator::MAX_AMOUNT],
            'lines.*.needed_by' => ['nullable', 'date_format:Y-m-d'],
            'lines.*.dimensions' => ['nullable', 'array', 'max:8'],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            foreach (array_values((array) $this->input('lines')) as $i => $line) {
                if (BigDecimal::of((string) ((array) $line)['quantity'])->isZero()) {
                    $validator->errors()->add("lines.{$i}.quantity", 'The quantity must be greater than zero.');
                }
            }
            $this->checkDimensions($validator);
        }];
    }

    public function toInput(): RequisitionDraftInput
    {
        $v = $this->validated();
        $slots = $this->dimensionSlots();

        /** @var list<array<string, mixed>> $lines */
        $lines = array_values((array) $v['lines']);

        return new RequisitionDraftInput(
            companyId: $this->company()->id,
            requisitionDate: new DateTimeImmutable((string) $v['requisition_date']),
            lines: array_map(fn (array $line): RequisitionLineInput => new RequisitionLineInput(
                quantity: (string) $line['quantity'],
                estimatedUnitPrice: (int) $line['estimated_unit_price'],
                itemId: isset($line['item_id']) ? (string) $line['item_id'] : null,
                description: isset($line['description']) ? (string) $line['description'] : null,
                accountId: isset($line['account_id']) ? (string) $line['account_id'] : null,
                dims: $this->slotted($line, $slots),
                neededBy: isset($line['needed_by']) ? new DateTimeImmutable((string) $line['needed_by']) : null,
            ), $lines),
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
