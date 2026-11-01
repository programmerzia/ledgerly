<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Actions\Trade\Inputs\ItemInput;
use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Create (POST) and replace (PUT, with the `version` it was based on) an item. Prices are whole minor units of its currency. */
final class ItemRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:5000'],
            'kind' => ['required', 'string', Rule::in(['service', 'good'])],
            'currency' => ['required', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'sales_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'purchase_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'sales_price' => ['nullable', 'integer', 'min:0', 'max:'.PostingValidator::MAX_AMOUNT],
            'purchase_price' => ['nullable', 'integer', 'min:0', 'max:'.PostingValidator::MAX_AMOUNT],
            'tax_code_id' => ['nullable', 'uuid', $this->inCompany('tax_codes')],
            'version' => [$this->isMethod('PUT') ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): ItemInput
    {
        $v = $this->validated();

        return new ItemInput(
            companyId: $this->company()->id,
            code: trim((string) $v['code']),
            name: trim((string) $v['name']),
            kind: (string) $v['kind'],
            currency: (string) $v['currency'],
            description: $v['description'] ?? null,
            salesAccountId: $v['sales_account_id'] ?? null,
            purchaseAccountId: $v['purchase_account_id'] ?? null,
            salesPrice: (int) ($v['sales_price'] ?? 0),
            purchasePrice: (int) ($v['purchase_price'] ?? 0),
            taxCodeId: $v['tax_code_id'] ?? null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
