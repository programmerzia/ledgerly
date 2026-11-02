<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Actions\Banking\Inputs\BankAccountInput;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Create (POST) or replace (PUT, with `version`) a bank account. The GL account must be of control type bank or cash (checked by the Action). */
final class BankAccountRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'name' => ['required', 'string', 'max:255'],
            'account_id' => ['required', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'currency' => ['required', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'kind' => ['nullable', 'string', Rule::in(['bank', 'cash', 'card'])],
            'bank_name' => ['nullable', 'string', 'max:255'],
            'account_number_masked' => ['nullable', 'string', 'max:64'],
            'iban' => ['nullable', 'string', 'max:34'],
            'swift' => ['nullable', 'string', 'max:11'],
            'import_mapping' => ['nullable', 'array'],
            'is_active' => ['nullable', 'boolean'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): BankAccountInput
    {
        $v = $this->validated();

        return new BankAccountInput(
            $this->company()->id, (string) $v['name'], (string) $v['account_id'], (string) $v['currency'], (string) ($v['kind'] ?? 'bank'),
            isset($v['bank_name']) ? (string) $v['bank_name'] : null, isset($v['account_number_masked']) ? (string) $v['account_number_masked'] : null,
            isset($v['iban']) ? (string) $v['iban'] : null, isset($v['swift']) ? (string) $v['swift'] : null,
            isset($v['import_mapping']) ? (array) $v['import_mapping'] : null, (bool) ($v['is_active'] ?? true),
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
