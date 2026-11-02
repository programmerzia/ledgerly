<?php

declare(strict_types=1);

namespace App\Http\Requests\Banking;

use App\Actions\Banking\Inputs\BankRuleInput;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Create (POST) or replace (PUT, with `version`) a bank rule; `priority` is optional (new rules go last; `PUT bank-rules/order` reorders). */
final class BankRuleRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'name' => ['required', 'string', 'max:255'],
            'bank_account_id' => ['nullable', 'uuid', $this->inCompany('bank_accounts')],
            'is_active' => ['nullable', 'boolean'],
            'priority' => ['nullable', 'integer', 'min:1', 'max:100000'],
            'conditions' => ['required', 'array'],
            'conditions.contains' => ['required', 'string', 'max:255'],
            'conditions.direction' => ['required', 'string', Rule::in(['in', 'out', 'any'])],
            'conditions.min_amount' => ['nullable', 'integer', 'min:0'],
            'conditions.max_amount' => ['nullable', 'integer', 'min:0'],
            'action' => ['required', 'array'],
            'action.account_id' => ['required', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'action.tax_code_id' => ['nullable', 'uuid', $this->inCompany('tax_codes')],
            'action.contact_id' => ['nullable', 'uuid', $this->inCompany('contacts')->whereNull('deleted_at')],
            'action.dimensions' => ['nullable', 'array', 'max:8'],
            'action.memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): BankRuleInput
    {
        $v = $this->validated();
        /** @var array{contains: string, direction: string, min_amount?: int|null, max_amount?: int|null} $c */
        $c = $v['conditions'];
        /** @var array{account_id: string, tax_code_id?: string|null, contact_id?: string|null, dimensions?: array<string, string>, memo?: string|null} $a */
        $a = $v['action'];

        return new BankRuleInput(
            $this->company()->id, (string) $v['name'], $c, $a, isset($v['bank_account_id']) ? (string) $v['bank_account_id'] : null,
            (bool) ($v['is_active'] ?? true), isset($v['priority']) ? (int) $v['priority'] : null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
