<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\PostingAccounts;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Trade\Contact;

/** The control, realised-FX and rounding accounts of a settlement (05 §2 posting_accounts); a contact's own control account wins. */
final class PostingAccountResolver
{
    public function forSettlement(Company $company, string $contactId, bool $onReceivables): PostingAccounts
    {
        $raw = CompanySettings::query()->where('company_id', $company->id)->first()?->getAttribute('posting_accounts');
        /** @var array<string, mixed> $settings */
        $settings = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        $contact = Contact::query()->where('company_id', $company->id)->withTrashed()->whereKey($contactId)->first();

        $control = $onReceivables
            ? ($contact->ar_account_id ?? $this->account($company, $settings, 'ar_control'))
            : ($contact->ap_account_id ?? $this->account($company, $settings, 'ap_control'));

        return new PostingAccounts(
            arControl: $onReceivables ? $control : '', apControl: $onReceivables ? '' : $control,
            taxOutput: '', taxInput: '',
            fxRealised: $this->account($company, $settings, 'fx_realised'), fxUnrealised: '',
            rounding: $this->account($company, $settings, 'rounding'), whtPayable: '',
            fxRealisedLoss: ($settings['fx_realised_loss'] ?? '') !== '' ? $this->account($company, $settings, 'fx_realised_loss') : '',
        );
    }

    /**
     * A posting account a newer feature needs, which a company on an older chart may not have: refuses with a message that
     * says where to set it. Never guesses an account.
     */
    public function required(Company $company, string $key, string $label): string
    {
        $found = $this->named($company, $key);
        if ($found === null) {
            throw DomainRuleViolation::single('posting_account_missing', "This needs the {$label} account. Set it in Settings → Posting ({$key}) and try again.");
        }

        return $found;
    }

    /** One configured posting account (`posting_accounts.<key>`) by id or code; null when it is not set. */
    public function named(Company $company, string $key): ?string
    {
        $raw = CompanySettings::query()->where('company_id', $company->id)->first()?->getAttribute('posting_accounts');
        /** @var array<string, mixed> $settings */
        $settings = is_string($raw) ? (json_decode($raw, true) ?: []) : (is_array($raw) ? $raw : []);
        if (! isset($settings[$key]) || $settings[$key] === '') {
            return null;
        }

        return $this->account($company, $settings, $key);
    }

    /** @param array<string, mixed> $settings */
    private function account(Company $company, array $settings, string $key): string
    {
        $ref = $settings[$key] ?? null;
        $account = is_string($ref) && $ref !== ''
            ? Account::query()->where('company_id', $company->id)->where(fn ($q) => $q->where('code', $ref)->when(
                preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/', $ref) === 1,
                fn ($q2) => $q2->orWhere('id', $ref),
            ))->first()
            : null;
        if ($account === null) {
            throw DomainRuleViolation::single('posting_account_missing', "Set the {$key} account (posting_accounts.{$key}) in the company settings.");
        }

        return $account->id;
    }
}
