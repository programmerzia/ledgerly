<?php

declare(strict_types=1);

namespace App\Http\Requests\Organisation;

use App\Actions\Organisation\Inputs\CompanySettingsInput;
use App\Actions\Organisation\UpdateCompanySettings;
use App\Domain\Ledger\PostingValidator;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** Partial update: send only what changes. Country and base currency are fixed at creation and rejected here. */
final class UpdateCompanySettingsRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $rules = [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'legal_name' => ['sometimes', 'nullable', 'string', 'max:255'],
            'tax_id' => ['sometimes', 'nullable', 'string', 'max:64'],
            'timezone' => ['sometimes', 'required', 'string', 'timezone:all'],
            'locale' => ['sometimes', 'required', 'string', 'max:16', 'regex:/^[a-z]{2}([_-][A-Za-z]{2,4})?$/'],
            'tax_rounding' => ['sometimes', 'required', 'string', Rule::in(['document_per_code', 'line'])],
            /** Whole minor units of the base currency. Above it a bank transaction needs a covering journal workflow; null: no limit. */
            'journal_threshold' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:'.PostingValidator::MAX_AMOUNT],
            /** Send what you loaded: a stale value answers 409. */
            'version' => ['sometimes', 'integer', 'min:0'],
            'posting_accounts' => ['sometimes', 'array:'.implode(',', array_keys(UpdateCompanySettings::POSTING_KEYS))],
            'country' => ['prohibited'],
            'base_currency' => ['prohibited'],
            'numbering' => ['prohibited'],
        ];
        foreach (array_keys(UpdateCompanySettings::POSTING_KEYS) as $key) {
            $rules["posting_accounts.{$key}"] = ['nullable', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')];
        }

        return $rules;
    }

    public function toInput(): CompanySettingsInput
    {
        $v = $this->validated();
        $profile = array_intersect_key($v, array_flip(['name', 'legal_name', 'tax_id', 'timezone', 'locale']));
        $posting = [];
        foreach ((array) ($v['posting_accounts'] ?? []) as $key => $id) {
            $posting[(string) $key] = $id === null ? null : (string) $id;
        }

        return new CompanySettingsInput(
            $this->company()->id, $profile, isset($v['tax_rounding']) ? (string) $v['tax_rounding'] : null, $posting,
            isset($v['version']) ? (int) $v['version'] : null,
            array_key_exists('journal_threshold', $v), isset($v['journal_threshold']) ? (int) $v['journal_threshold'] : null,
        );
    }
}
