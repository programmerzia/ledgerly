<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Actions\Trade\Inputs\InvoiceLineInput;
use App\Domain\Ledger\PostingValidator;
use App\Domain\Trade\InvoiceKind;
use App\Http\Requests\CompanyRequest;
use App\Models\Ledger\DimensionValue;
use App\Queries\Ledger\DimensionPositions;
use Brick\Math\BigDecimal;
use DateTimeImmutable;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Validation\Rule;

/**
 * Create (POST) or replace (PUT, with `version`) a draft invoice, credit note, bill or debit note. Shape only:
 * ids exist in this company, quantities and rates are decimal strings, prices whole minor units. Totals, tax and
 * base amounts are not accepted: whatever the client sends for them is ignored and the server calculates.
 * Whether the contact fits the kind, the tax code has a rate that day, or the rate exists is the Action's call.
 *
 * Line dimensions are `{"<dimension id>": "<dimension value id>"}`. On `/bills` the kind is purchase_bill
 * (default) or debit_note; on `/invoices` sales_invoice (default) or credit_note.
 */
final class InvoiceRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');
        $sales = $this->sales();

        return [
            'kind' => [$update ? 'prohibited' : 'nullable', 'string', Rule::in(InvoiceKind::values(...($sales ? InvoiceKind::sales() : InvoiceKind::purchases())))],
            'contact_id' => ['required', 'uuid', $this->inCompany('contacts')->whereNull('deleted_at')],
            'issue_date' => ['required', 'date_format:Y-m-d'],
            'due_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:issue_date'],
            'currency' => ['nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'fx_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'related_invoice_id' => ['nullable', 'uuid', $this->inCompany('invoices')],
            'wht_code_id' => [$sales ? 'prohibited' : 'nullable', 'uuid', $this->inCompany('tax_codes')],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.item_id' => ['nullable', 'uuid', $this->inCompany('items')],
            'lines.*.account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'lines.*.description' => ['nullable', 'string', 'max:1000'],
            'lines.*.quantity' => ['required', 'string', 'regex:/^\d{1,12}(\.\d{1,6})?$/'],
            'lines.*.unit_price_fc' => ['nullable', 'integer', 'min:0', 'max:'.PostingValidator::MAX_AMOUNT],
            'lines.*.discount_pct' => ['nullable', 'string', 'regex:/^\d{1,3}(\.\d{1,4})?$/'],
            'lines.*.tax_code_id' => ['nullable', 'uuid', $this->inCompany('tax_codes')],
            'lines.*.dimensions' => ['nullable', 'array', 'max:8'],
            /** The purchase order line this bill line bills. A PUT replaces the lines: send it again or the link is gone. */
            'lines.*.purchase_order_line_id' => [$sales ? 'prohibited' : 'nullable', 'uuid', $this->inCompany('purchase_order_lines')],
            'lines.*.goods_receipt_line_id' => [$sales ? 'prohibited' : 'nullable', 'uuid', $this->inCompany('goods_receipt_lines')],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            $this->checkAmounts($validator);
            $this->checkDimensions($validator);
        }];
    }

    public function toInput(?InvoiceKind $fixedKind = null): InvoiceDraftInput
    {
        $v = $this->validated();
        $kind = $fixedKind ?? InvoiceKind::from((string) ($v['kind'] ?? ($this->sales() ? 'sales_invoice' : 'purchase_bill')));
        $slots = array_flip((new DimensionPositions)($this->company()->id));

        $lines = array_map(function (array $line) use ($slots): InvoiceLineInput {
            $dims = [];
            foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
                $dims[$slots[(string) $dimensionId]] = (string) $valueId;
            }

            return new InvoiceLineInput(
                quantity: (string) $line['quantity'],
                itemId: isset($line['item_id']) ? (string) $line['item_id'] : null,
                accountId: isset($line['account_id']) ? (string) $line['account_id'] : null,
                description: isset($line['description']) ? (string) $line['description'] : null,
                unitPriceFc: isset($line['unit_price_fc']) ? (int) $line['unit_price_fc'] : null,
                discountPct: isset($line['discount_pct']) ? (string) $line['discount_pct'] : '0',
                taxCodeId: isset($line['tax_code_id']) ? (string) $line['tax_code_id'] : null,
                taxCodeGiven: array_key_exists('tax_code_id', $line),
                dims: $dims,
                purchaseOrderLineId: isset($line['purchase_order_line_id']) ? (string) $line['purchase_order_line_id'] : null,
                goodsReceiptLineId: isset($line['goods_receipt_line_id']) ? (string) $line['goods_receipt_line_id'] : null,
            );
        }, array_values($v['lines']));

        return new InvoiceDraftInput(
            companyId: $this->company()->id,
            kind: $kind,
            contactId: (string) $v['contact_id'],
            issueDate: new DateTimeImmutable((string) $v['issue_date']),
            lines: $lines,
            dueDate: isset($v['due_date']) ? new DateTimeImmutable((string) $v['due_date']) : null,
            currency: isset($v['currency']) ? (string) $v['currency'] : null,
            fxRate: isset($v['fx_rate']) ? (string) $v['fx_rate'] : null,
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
            relatedInvoiceId: isset($v['related_invoice_id']) ? (string) $v['related_invoice_id'] : null,
            whtCodeId: isset($v['wht_code_id']) ? (string) $v['wht_code_id'] : null,
            whtCodeGiven: array_key_exists('wht_code_id', $v),
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }

    private function sales(): bool
    {
        return ! str_starts_with((string) $this->route()?->getName(), 'bills.');
    }

    /** Quantities are positive and discounts at most 100%; both arrive as strings (13 §16). */
    private function checkAmounts(Validator $validator): void
    {
        foreach (array_values((array) $this->input('lines')) as $i => $line) {
            $line = (array) $line;
            if (BigDecimal::of((string) $line['quantity'])->isZero()) {
                $validator->errors()->add("lines.{$i}.quantity", 'The quantity must be greater than zero.');
            }
            if (isset($line['discount_pct']) && BigDecimal::of((string) $line['discount_pct'])->isGreaterThan(100)) {
                $validator->errors()->add("lines.{$i}.discount_pct", 'The discount cannot be more than 100%.');
            }
        }
    }

    private function checkDimensions(Validator $validator): void
    {
        /** @var list<array<string, mixed>> $lines */
        $lines = array_values((array) $this->input('lines'));
        $known = array_flip((new DimensionPositions)($this->company()->id));

        $valueIds = [];
        foreach ($lines as $i => $line) {
            foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
                if (! isset($known[(string) $dimensionId])) {
                    $validator->errors()->add("lines.{$i}.dimensions", "Dimension {$dimensionId} does not exist in this company.");
                } elseif (! is_string($valueId)) {
                    $validator->errors()->add("lines.{$i}.dimensions.{$dimensionId}", 'Name a dimension value id.');
                } else {
                    $valueIds[$valueId] = true;
                }
            }
        }
        $found = $valueIds === [] ? [] : DimensionValue::query()->where('company_id', $this->company()->id)->whereIn('id', array_keys($valueIds))->pluck('dimension_id', 'id')->all();
        foreach ($lines as $i => $line) {
            foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
                if (isset($known[(string) $dimensionId]) && is_string($valueId) && ($found[$valueId] ?? null) !== (string) $dimensionId) {
                    $validator->errors()->add("lines.{$i}.dimensions.{$dimensionId}", 'This value does not belong to the dimension in this company.');
                }
            }
        }
    }
}
