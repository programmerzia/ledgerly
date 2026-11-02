<?php

declare(strict_types=1);

namespace App\Http\Requests\Procurement;

use App\Actions\Procurement\Inputs\GoodsReceiptInput;
use App\Actions\Procurement\Inputs\ReceiptLineInput;
use App\Http\Requests\CompanyRequest;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Contracts\Validation\Validator;

/**
 * Record goods received against an approved order. Receipts are not edited: a mistake is reversed and re-entered.
 * `order_version` is the order version the person was looking at; a stale one is a 409.
 */
final class GoodsReceiptRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'purchase_order_id' => ['required', 'uuid', $this->inCompany('purchase_orders')],
            'receipt_date' => ['required', 'date_format:Y-m-d'],
            'order_version' => ['nullable', 'integer', 'min:0'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.order_line_id' => ['required', 'uuid'],
            'lines.*.quantity' => ['required', 'string', 'regex:/^\d{1,12}(\.\d{1,6})?$/'],
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
        }];
    }

    public function toInput(): GoodsReceiptInput
    {
        $v = $this->validated();

        /** @var list<array<string, mixed>> $lines */
        $lines = array_values((array) $v['lines']);

        return new GoodsReceiptInput(
            companyId: $this->company()->id,
            orderId: (string) $v['purchase_order_id'],
            receiptDate: new DateTimeImmutable((string) $v['receipt_date']),
            lines: array_map(fn (array $l): ReceiptLineInput => new ReceiptLineInput((string) $l['order_line_id'], (string) $l['quantity']), $lines),
            orderVersion: isset($v['order_version']) ? (int) $v['order_version'] : null,
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
        );
    }
}
