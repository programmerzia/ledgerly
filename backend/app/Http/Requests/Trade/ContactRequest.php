<?php

declare(strict_types=1);

namespace App\Http\Requests\Trade;

use App\Actions\Trade\Inputs\ContactInput;
use App\Http\Requests\CompanyRequest;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Create (POST) and replace (PUT, with the `version` it was based on) a contact. */
final class ContactRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'kind' => ['required', 'string', Rule::in(['customer', 'supplier', 'both'])],
            'code' => ['required', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'legal_name' => ['nullable', 'string', 'max:255'],
            'tax_id' => ['nullable', 'string', 'max:64'],
            'email' => ['nullable', 'string', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'max:64'],
            'billing_address' => ['nullable', 'array'],
            'shipping_address' => ['nullable', 'array'],
            'default_currency' => ['required', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'payment_terms_days' => ['nullable', 'integer', 'min:0', 'max:3650'],
            'credit_limit' => ['nullable', 'array'],
            'credit_limit.amount' => ['required_with:credit_limit', 'integer', 'min:0'],
            'credit_limit.currency' => ['required_with:credit_limit', 'string', 'same:default_currency'],
            'ar_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'ap_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'wht_code_id' => ['nullable', 'uuid', $this->inCompany('tax_codes')],
            'default_account_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'default_tax_code_id' => ['nullable', 'uuid', $this->inCompany('tax_codes')],
            'default_branch' => ['nullable', 'string', 'max:64'],
            'default_dims' => ['nullable', 'array', $this->dimensionsInCompany()],
            'default_dims.*' => ['string'],
            'notes' => ['nullable', 'string', 'max:5000'],
            'version' => [$this->isMethod('PUT') ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    /** Every key is a dimension of the company and every value one of its values. */
    private function dimensionsInCompany(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            foreach (is_array($value) ? $value : [] as $dimensionId => $valueId) {
                $ok = is_string($valueId) && DB::table('dimension_values')
                    ->where('company_id', $this->company()->id)->where('dimension_id', (string) $dimensionId)->where('id', $valueId)->exists();
                if (! $ok) {
                    $fail("The default dimension {$dimensionId} is not a dimension value of this company.");

                    return;
                }
            }
        };
    }

    public function toInput(): ContactInput
    {
        $v = $this->validated();
        /** @var array<string, string> $dims */
        $dims = $v['default_dims'] ?? [];

        return new ContactInput(
            companyId: $this->company()->id,
            kind: (string) $v['kind'],
            code: trim((string) $v['code']),
            name: trim((string) $v['name']),
            defaultCurrency: (string) $v['default_currency'],
            legalName: $v['legal_name'] ?? null,
            taxId: $v['tax_id'] ?? null,
            email: $v['email'] ?? null,
            phone: $v['phone'] ?? null,
            billingAddress: $v['billing_address'] ?? null,
            shippingAddress: $v['shipping_address'] ?? null,
            paymentTermsDays: (int) ($v['payment_terms_days'] ?? 0),
            creditLimit: isset($v['credit_limit']['amount']) ? (int) $v['credit_limit']['amount'] : null,
            arAccountId: $v['ar_account_id'] ?? null,
            apAccountId: $v['ap_account_id'] ?? null,
            whtCodeId: $v['wht_code_id'] ?? null,
            defaultAccountId: $v['default_account_id'] ?? null,
            defaultTaxCodeId: $v['default_tax_code_id'] ?? null,
            defaultBranch: $v['default_branch'] ?? null,
            defaultDims: $dims,
            notes: $v['notes'] ?? null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
