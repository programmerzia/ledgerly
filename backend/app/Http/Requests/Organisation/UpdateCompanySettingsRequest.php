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
            /** Bills must link every line to a purchase order; a person with `bills.match_override` can still pass one with a reason. */
            'require_purchase_order' => ['sometimes', 'required', 'boolean'],
            /** Decimal strings, 0 to 100: how far a bill's price may differ from the order, how far billed may exceed received, how far received may exceed ordered. */
            'po_price_tolerance_pct' => ['sometimes', 'required', 'string', 'regex:/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/'],
            'po_quantity_tolerance_pct' => ['sometimes', 'required', 'string', 'regex:/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/'],
            'receipt_over_tolerance_pct' => ['sometimes', 'required', 'string', 'regex:/^(100(\.0{1,4})?|\d{1,2}(\.\d{1,4})?)$/'],
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
            isset($v['require_purchase_order']) ? (bool) $v['require_purchase_order'] : null,
            isset($v['po_price_tolerance_pct']) ? (string) $v['po_price_tolerance_pct'] : null,
            isset($v['po_quantity_tolerance_pct']) ? (string) $v['po_quantity_tolerance_pct'] : null,
            isset($v['receipt_over_tolerance_pct']) ? (string) $v['receipt_over_tolerance_pct'] : null,
        );
    }
}
