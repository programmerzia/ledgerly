<?php

declare(strict_types=1);

namespace App\Http\Requests\Concerns;

use App\Actions\Procurement\Inputs\OrderLineInput;
use App\Domain\Ledger\PostingValidator;
use Brick\Math\BigDecimal;
use Illuminate\Contracts\Validation\Validator;

/**
 * The lines of a purchase order and of a revision of one: shape only. A line may carry the `id` of a line the order
 * already has (it keeps its identity); a requisition link is never accepted from a client. Amounts are the server's.
 */
trait ShapesOrderLines
{
    use ChecksLineDimensions;

    /** @return array<string, mixed> */
    private function orderLineRules(): array
    {
        return [
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            /** The id of a line this order already has; send it to keep the line's identity and what was received. */
            'lines.*.id' => ['nullable', 'uuid'],
            'lines.*.item_id' => ['nullable', 'uuid', $this->inCompany('items')],
            'lines.*.account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'lines.*.description' => ['nullable', 'string', 'max:1000'],
            'lines.*.quantity' => ['required', 'string', 'regex:/^\d{1,12}(\.\d{1,6})?$/'],
            'lines.*.unit_price_fc' => ['nullable', 'integer', 'min:0', 'max:'.PostingValidator::MAX_AMOUNT],
            'lines.*.tax_code_id' => ['nullable', 'uuid', $this->inCompany('tax_codes')],
            'lines.*.dimensions' => ['nullable', 'array', 'max:8'],
        ];
    }

    private function checkOrderLines(Validator $validator): void
    {
        if ($validator->errors()->isNotEmpty()) {
            return;
        }
        foreach (array_values((array) $this->input('lines')) as $i => $line) {
            if (BigDecimal::of((string) ((array) $line)['quantity'])->isZero()) {
                $validator->errors()->add("lines.{$i}.quantity", 'The quantity must be greater than zero.');
            }
        }
        $this->checkDimensions($validator);
    }

    /** @return list<OrderLineInput> */
    private function orderLineInputs(): array
    {
        $slots = $this->dimensionSlots();

        /** @var list<array<string, mixed>> $lines */
        $lines = array_values((array) $this->validated()['lines']);

        return array_map(fn (array $line): OrderLineInput => new OrderLineInput(
            quantity: (string) $line['quantity'],
            id: isset($line['id']) ? (string) $line['id'] : null,
            itemId: isset($line['item_id']) ? (string) $line['item_id'] : null,
            accountId: isset($line['account_id']) ? (string) $line['account_id'] : null,
            description: isset($line['description']) ? (string) $line['description'] : null,
            unitPriceFc: isset($line['unit_price_fc']) ? (int) $line['unit_price_fc'] : null,
            taxCodeId: isset($line['tax_code_id']) ? (string) $line['tax_code_id'] : null,
            taxCodeGiven: array_key_exists('tax_code_id', $line),
            dims: $this->slotted($line, $slots),
        ), $lines);
    }
}
