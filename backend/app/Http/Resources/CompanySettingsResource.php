<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Actions\Organisation\UpdateCompanySettings;
use App\Domain\Documents\MessageTemplate;
use App\Http\Support\Json;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Services\Documents\DocumentLook;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The company profile with its settings. Posting accounts are returned for every key (null when not set) with the
 * account's code and name. Approval limits are the company's approval workflows (`/approval-workflows`).
 *
 * @mixin Company
 */
final class CompanySettingsResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $settings = CompanySettings::query()->where('company_id', $this->id)->first();
        $stored = $settings === null ? [] : $settings->posting_accounts;
        $accounts = Account::query()->where('company_id', $this->id)
            ->where(fn ($q) => $q->whereIn('id', array_filter($stored, fn ($v) => preg_match('/^[0-9a-f-]{36}$/', (string) $v) === 1))->orWhereIn('code', array_values($stored)))->get();

        $posting = $this->postingAccounts($stored, $accounts);
        $look = DocumentLook::normalise($settings === null ? [] : (array) $settings->getAttribute('document_templates'));
        $defaults = $settings === null ? [] : $settings->getAttribute('approval_defaults');
        $threshold = is_array($defaults) && isset($defaults['journal_threshold']) ? (int) $defaults['journal_threshold'] : null;

        return [
            'company_id' => $this->id,
            'name' => $this->name,
            'legal_name' => $this->legal_name,
            'tax_id' => $this->tax_id,
            'country' => $this->country,
            'base_currency' => $this->base_currency,
            'timezone' => $this->timezone,
            'locale' => $this->locale,
            'fiscal_year_start_month' => $this->fiscal_year_start_month,
            'tax_rounding' => $settings === null ? 'document_per_code' : $settings->tax_rounding,
            'posting_accounts' => $posting,
            /** Above it a bank transaction needs a covering journal workflow; null: no limit. */
            'journal_threshold' => $threshold === null ? null : Json::money($threshold, $this->base_currency),
            'require_purchase_order' => $settings !== null && (bool) $settings->getAttribute('require_purchase_order'),
            /** Decimal strings, percent. */
            'po_price_tolerance_pct' => $settings === null ? '0.0000' : (string) $settings->getAttribute('po_price_tolerance_pct'),
            'po_quantity_tolerance_pct' => $settings === null ? '0.0000' : (string) $settings->getAttribute('po_quantity_tolerance_pct'),
            'receipt_over_tolerance_pct' => $settings === null ? '0.0000' : (string) $settings->getAttribute('receipt_over_tolerance_pct'),
            /** Printed on every PDF (plan 3c.4). `has_logo`: upload with `POST settings/logo`, show with `GET settings/logo`. */
            'document_look' => [
                'accent_color' => (string) $look['accent_color'], 'footer_text' => (string) $look['footer_text'],
                'payment_instructions' => (string) $look['payment_instructions'], 'has_logo' => $this->getAttribute('logo_path') !== null,
                /** Display name on outgoing mail (empty: the company name) and the address replies go to (empty: none). */
                'sender_name' => (string) $look['sender_name'], 'reply_to' => (string) $look['reply_to'],
                /** The address mail is sent from. It is fixed by the platform: a customer's own domain would fail SPF and DKIM. */
                'from_address' => (string) config('mail.from.address'),
            ],
            /**
             * Subject and body per family (invoice, credit_note, statement, payment_advice, receipt), defaults filled in.
             *
             * @var array<string, array{subject: string, body: string}>
             */
            'email_templates' => $look['email'],
            /** The only `{{ placeholders }}` a template may use, with what each stands for. */
            'email_placeholders' => MessageTemplate::PLACEHOLDERS,
            /** off | warn | refuse */
            'credit_limit_mode' => $settings === null ? 'off' : (string) $settings->getAttribute('credit_limit_mode'),
            'version' => $settings === null ? 0 : (int) $settings->getAttribute('lock_version'),
            'can' => ['update' => (bool) $request->user()?->can('update', $this->resource)],
        ];
    }

    /**
     * @param  array<string, string>  $stored
     * @param  Collection<int, Account>  $accounts
     * @return array<string, array{account_id: string, code: string, name: string}|null>
     */
    private function postingAccounts(array $stored, Collection $accounts): array
    {
        $posting = [];
        foreach (array_keys(UpdateCompanySettings::POSTING_KEYS) as $key) {
            $ref = $stored[$key] ?? null;
            $account = $ref === null ? null : $accounts->first(fn (Account $a) => $a->id === $ref || $a->code === $ref);
            $posting[$key] = $account === null ? null : ['account_id' => $account->id, 'code' => $account->code, 'name' => $account->name];
        }

        return $posting;
    }
}
