<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Actions\Ledger\Inputs\AccountInput;
use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Create (POST) and replace (PUT, with the `version` it was based on) an account. */
final class AccountRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'code' => ['required', 'string', 'max:32', 'regex:/^[A-Za-z0-9._-]+$/'],
            'name' => ['required', 'string', 'max:255'],
            'account_type' => ['required', 'string', Rule::in(['asset', 'liability', 'equity', 'income', 'expense'])],
            'account_subtype' => ['nullable', 'string', 'max:64'],
            'normal_balance' => ['required', 'string', Rule::in(['debit', 'credit'])],
            'parent_id' => ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'currency_policy' => ['nullable', Rule::enum(CurrencyPolicy::class)],
            'fixed_currency' => ['nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'control_type' => ['nullable', Rule::enum(ControlType::class)],
            'allow_manual_journals' => ['nullable', 'boolean'],
            'is_postable' => ['nullable', 'boolean'],
            'description' => ['nullable', 'string', 'max:2000'],
            'version' => [$this->isMethod('PUT') ? 'required' : 'prohibited', 'integer', 'min:0'],
        ];
    }

    public function toInput(): AccountInput
    {
        $v = $this->validated();

        return new AccountInput(
            companyId: $this->company()->id,
            code: trim((string) $v['code']),
            name: trim((string) $v['name']),
            accountType: (string) $v['account_type'],
            normalBalance: (string) $v['normal_balance'],
            parentId: $v['parent_id'] ?? null,
            currencyPolicy: CurrencyPolicy::from((string) ($v['currency_policy'] ?? 'base_only')),
            fixedCurrency: $v['fixed_currency'] ?? null,
            controlType: ControlType::from((string) ($v['control_type'] ?? 'none')),
            allowManualJournals: (bool) ($v['allow_manual_journals'] ?? false),
            isPostable: (bool) ($v['is_postable'] ?? true),
            accountSubtype: $v['account_subtype'] ?? null,
            description: $v['description'] ?? null,
        );
    }

    public function version(): int
    {
        return (int) $this->validated()['version'];
    }
}
