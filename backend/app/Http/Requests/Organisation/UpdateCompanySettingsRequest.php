<?php

declare(strict_types=1);

namespace App\Http\Requests\Organisation;

use App\Actions\Organisation\Inputs\CompanySettingsInput;
use App\Actions\Organisation\UpdateCompanySettings;
use App\Domain\Documents\DocumentDefaults;
use App\Domain\Documents\MessageTemplate;
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
            /** Document look (plan 3c.4): a #RRGGBB colour, a footer line and payment instructions printed on documents. */
            'accent_color' => ['sometimes', 'required', 'string', 'regex:/^#[0-9A-Fa-f]{6}$/'],
            'footer_text' => ['sometimes', 'nullable', 'string', 'max:300'],
            'payment_instructions' => ['sometimes', 'nullable', 'string', 'max:1000'],
            /** Email templates (plan 3c.5) by family. Only the listed `{{ placeholders }}` are allowed. */
            'email_templates' => ['sometimes', 'array:'.implode(',', DocumentDefaults::EMAIL_TYPES)],
            /** Send what you loaded: a stale value answers 409. */
            'version' => ['sometimes', 'integer', 'min:0'],
            'posting_accounts' => ['sometimes', 'array:'.implode(',', array_keys(UpdateCompanySettings::POSTING_KEYS))],
            'country' => ['prohibited'],
            'base_currency' => ['prohibited'],
            'numbering' => ['prohibited'],
        ];
        foreach (DocumentDefaults::EMAIL_TYPES as $type) {
            $unknown = function (string $attribute, mixed $value, \Closure $fail): void {
                $bad = MessageTemplate::unknown((string) $value);
                if ($bad !== []) {
                    $fail('Unknown placeholder '.implode(', ', array_map(fn (string $b) => '{{ '.$b.' }}', $bad)).'. Use only: '.implode(', ', array_keys(MessageTemplate::PLACEHOLDERS)).'.');
                }
            };
            $rules["email_templates.{$type}"] = ['sometimes', 'array:subject,body'];
            $rules["email_templates.{$type}.subject"] = ['required_with:email_templates.'.$type, 'string', 'min:1', 'max:200', $unknown];
            $rules["email_templates.{$type}.body"] = ['required_with:email_templates.'.$type, 'string', 'min:1', 'max:5000', $unknown];
        }
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
            array_intersect_key($v, array_flip(['accent_color', 'footer_text', 'payment_instructions', 'email_templates'])),
        );
    }
}
