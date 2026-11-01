<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\SetupGuard;
use App\Actions\Trade\Inputs\ContactInput;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\ControlType;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Account;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Models\Tax\TaxCode;
use App\Models\Trade\Contact;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Customers and suppliers. `contacts.manage` covers all kinds; `contacts.manage_customers` (the Sales Assistant's
 * right) covers customers only, so changing a contact needs the right for its current kind and for the kind it
 * becomes. Contacts are deactivated, never deleted, and keep their code.
 */
final class ManageContact
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
    ) {}

    public function create(Actor $actor, ContactInput $in): Contact
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->authorize($actor, $in->companyId, $in->kind);
            $this->validate($in, null);

            $contact = new Contact;
            $contact->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, ...$this->columns($in),
            ])->save();
            $contact->refresh();
            $audit->add('contact.created', $contact, after: $contact);

            return $contact;
        });
    }

    public function update(Actor $actor, string $contactId, int $version, ContactInput $in): Contact
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $contactId, $version, $in) {
            $contact = $locks->document(Contact::query()->findOrFail($contactId), $version);
            $this->authorize($actor, $contact->company_id, $contact->kind, $in->kind);
            $this->validate($in, $contact);

            $before = $contact->attributesToArray();
            $contact->forceFill([...$this->columns($in), 'lock_version' => $contact->lock_version + 1])->save();
            $contact->refresh();
            $audit->add('contact.updated', $contact, before: $before, after: $contact);

            return $contact;
        });
    }

    public function deactivate(Actor $actor, string $contactId, int $version): Contact
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $contactId, $version) {
            $contact = $locks->document(Contact::query()->findOrFail($contactId), $version);
            $this->authorize($actor, $contact->company_id, $contact->kind);
            if (! $contact->is_active) {
                throw DomainRuleViolation::single('contact_already_inactive', 'The contact is already inactive.');
            }

            $before = $contact->attributesToArray();
            $contact->forceFill(['is_active' => false, 'lock_version' => $contact->lock_version + 1])->save();
            $contact->refresh();
            $audit->add('contact.deactivated', $contact, before: $before, after: $contact);

            return $contact;
        });
    }

    private function authorize(Actor $actor, string $companyId, string ...$kinds): void
    {
        foreach (array_unique($kinds) as $kind) {
            $this->guard->require($actor, $kind === 'customer' ? 'contacts.manage_customers' : 'contacts.manage', $companyId, tokens: true);
        }
    }

    /** @return array<string, mixed> */
    private function columns(ContactInput $in): array
    {
        return [
            'kind' => $in->kind, 'code' => $in->code, 'name' => $in->name, 'legal_name' => $in->legalName, 'tax_id' => $in->taxId,
            'email' => $in->email, 'phone' => $in->phone,
            'billing_address' => $in->billingAddress,
            'shipping_address' => $in->shippingAddress,
            'default_currency' => $in->defaultCurrency, 'payment_terms_days' => $in->paymentTermsDays, 'credit_limit' => $in->creditLimit,
            'ar_account_id' => $in->arAccountId, 'ap_account_id' => $in->apAccountId, 'wht_code_id' => $in->whtCodeId,
            'default_account_id' => $in->defaultAccountId, 'default_tax_code_id' => $in->defaultTaxCodeId,
            'default_branch' => $in->defaultBranch, 'default_dims' => $in->defaultDims,
            'notes' => $in->notes,
        ];
    }

    private function validate(ContactInput $in, ?Contact $current): void
    {
        // Soft-deleted contacts keep owning their code.
        $taken = Contact::query()->withTrashed()->where('company_id', $in->companyId)->where('code', $in->code)
            ->when($current !== null, fn ($q) => $q->where('id', '!=', $current?->id));
        if ($taken->exists()) {
            throw DomainRuleViolation::single('contact_code_taken', "Contact code {$in->code} is already used in this company.");
        }

        if ($in->arAccountId !== null) {
            if ($in->kind === 'supplier') {
                throw DomainRuleViolation::single('contact_account_invalid', 'A supplier has no receivable account.');
            }
            $this->requireControlAccount($in->companyId, $in->arAccountId, ControlType::Ar, 'receivable');
        }
        if ($in->apAccountId !== null) {
            if ($in->kind === 'customer') {
                throw DomainRuleViolation::single('contact_account_invalid', 'A customer has no payable account.');
            }
            $this->requireControlAccount($in->companyId, $in->apAccountId, ControlType::Ap, 'payable');
        }
        if ($in->defaultAccountId !== null && ! Account::query()->where('company_id', $in->companyId)->whereKey($in->defaultAccountId)->where('is_active', true)->exists()) {
            throw DomainRuleViolation::single('contact_account_invalid', 'The default account must be an active account of this company.');
        }
        if ($in->whtCodeId !== null && ! TaxCode::query()->where('company_id', $in->companyId)->whereKey($in->whtCodeId)->where('kind', 'wht')->where('is_active', true)->exists()) {
            throw DomainRuleViolation::single('contact_tax_code_invalid', 'The withholding code must be an active withholding tax code of this company.');
        }
        if ($in->defaultTaxCodeId !== null && ! TaxCode::query()->where('company_id', $in->companyId)->whereKey($in->defaultTaxCodeId)->where('is_active', true)->exists()) {
            throw DomainRuleViolation::single('contact_tax_code_invalid', 'The default tax code must be an active tax code of this company.');
        }
        foreach ($in->defaultDims as $dimensionId => $valueId) {
            $ok = Dimension::query()->where('company_id', $in->companyId)->whereKey($dimensionId)->exists()
                && DimensionValue::query()->where('company_id', $in->companyId)->where('dimension_id', $dimensionId)->whereKey($valueId)->exists();
            if (! $ok) {
                throw DomainRuleViolation::single('contact_dimension_invalid', 'Default dimensions must be values of this company\'s dimensions.');
            }
        }
    }

    private function requireControlAccount(string $companyId, string $accountId, ControlType $type, string $label): void
    {
        $ok = Account::query()->where('company_id', $companyId)->whereKey($accountId)->where('control_type', $type->value)->where('is_active', true)->exists();
        if (! $ok) {
            throw DomainRuleViolation::single('contact_account_invalid', "The {$label} account must be an active {$type->value} control account of this company.");
        }
    }
}
