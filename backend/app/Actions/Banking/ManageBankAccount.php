<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Banking\Inputs\BankAccountInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\CurrencyPolicy;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankStatementLine;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Trade\Settlement;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Creates and edits bank accounts. A bank account is a GL account of control type bank or cash plus a currency that account allows
 * (base-only: the company currency; fixed: that currency; any: any). Changing the GL account or the currency is refused once the
 * account has statement lines or settlements. Needs `accounts.manage` (it decides which ledger account is the bank): people only.
 */
final class ManageBankAccount
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly IdGenerator $ids) {}

    public function create(Actor $actor, BankAccountInput $in): BankAccount
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'accounts.manage', $in->companyId);
            $this->check($in, null);
            $b = new BankAccount;
            $b->forceFill([...$this->attributes($in), 'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'lock_version' => 0])->save();
            $audit->add('bank_account.created', $b, after: $b);

            return $b;
        });
    }

    public function update(Actor $actor, string $id, int $lockVersion, BankAccountInput $in): BankAccount
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $id, $lockVersion, $in) {
            $this->guard->require($actor, 'accounts.manage', $in->companyId);
            $seen = BankAccount::query()->where('company_id', $in->companyId)->find($id) ?? throw DomainRuleViolation::single('not_found', 'The bank account does not exist.');
            $b = $locks->document($seen, $lockVersion);
            $this->check($in, $b);
            $before = $b->attributesToArray();
            $b->forceFill([...$this->attributes($in), 'lock_version' => $b->lock_version + 1])->save();
            $audit->add('bank_account.updated', $b, before: $before, after: $b);

            return $b;
        });
    }

    /** @return array<string, mixed> */
    private function attributes(BankAccountInput $in): array
    {
        return [
            'name' => $in->name, 'account_id' => $in->accountId, 'currency' => $in->currency, 'kind' => $in->kind, 'bank_name' => $in->bankName,
            'account_number_masked' => $in->accountNumberMasked, 'iban' => $in->iban, 'swift' => $in->swift, 'import_mapping' => $in->importMapping,
            'is_active' => $in->isActive,
        ];
    }

    private function check(BankAccountInput $in, ?BankAccount $existing): void
    {
        $account = Account::query()->where('company_id', $in->companyId)->find($in->accountId)
            ?? throw DomainRuleViolation::single('account_invalid', 'The GL account does not exist in this company.');
        if (! in_array($account->control_type, [ControlType::Bank, ControlType::Cash], true) || ! $account->is_active || ! $account->is_postable) {
            throw DomainRuleViolation::single('bank_gl_account_invalid', 'A bank account links to an active, postable GL account of control type bank or cash.');
        }
        if ($existing !== null && ($existing->account_id !== $in->accountId || $existing->currency !== $in->currency)) {
            $used = BankStatementLine::query()->where('bank_account_id', $existing->id)->exists()
                || Settlement::query()->where('bank_account_id', $existing->id)->exists();
            if ($used) {
                throw DomainRuleViolation::single('bank_account_in_use', 'The GL account and currency cannot change once the account has statement lines or settlements.');
            }
        }
        $base = Company::query()->findOrFail($in->companyId)->base_currency;
        $allowed = match ($account->currency_policy) {
            CurrencyPolicy::BaseOnly => $in->currency === $base,
            CurrencyPolicy::Fixed => $in->currency === $account->fixed_currency,
            CurrencyPolicy::Any => true,
        };
        if (! $allowed) {
            throw DomainRuleViolation::single('currency_not_allowed', "The GL account {$account->code} does not allow {$in->currency}.");
        }
        $taken = BankAccount::query()->where('company_id', $in->companyId)->where('account_id', $in->accountId)->when($existing !== null, fn ($q) => $q->where('id', '!=', $existing?->id))->exists();
        if ($taken) {
            throw DomainRuleViolation::single('bank_gl_account_taken', 'Another bank account already uses this GL account.');
        }
        $nameTaken = BankAccount::query()->where('company_id', $in->companyId)->where('name', $in->name)->when($existing !== null, fn ($q) => $q->where('id', '!=', $existing?->id))->exists();
        if ($nameTaken) {
            throw DomainRuleViolation::single('bank_account_name_taken', 'A bank account with this name exists.');
        }
    }
}
