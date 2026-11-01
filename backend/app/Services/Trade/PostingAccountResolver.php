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
        );
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
