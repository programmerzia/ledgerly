<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Actions\Ledger\Inputs\AccountInput;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\CurrencyPolicy;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Account;
use App\Models\Ledger\JournalLine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Chart of accounts maintenance (`accounts.manage`). Accounts are never deleted: they are deactivated and
 * keep their code. Once an account has journal lines, what its balance means (type, normal balance,
 * currency policy) is frozen; name, description, parent and flags stay editable.
 */
final class ManageAccount
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
    ) {}

    public function create(Actor $actor, AccountInput $in): Account
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'accounts.manage', $in->companyId, tokens: true);
            $this->assertShape($in);
            $this->assertCodeFree($in->companyId, $in->code, null);
            $this->assertParent($in->companyId, $in->parentId, null);

            $account = new Account;
            $account->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId,
                ...$this->columns($in),
            ])->save();
            $account->refresh();
            $audit->add('account.created', $account, after: $account);

            return $account;
        });
    }

    /** Read-only: the rules `create` applies to this input (imports preview with it). Throws what `create` would throw. */
    public function check(AccountInput $in): void
    {
        $this->assertShape($in);
        $this->assertCodeFree($in->companyId, $in->code, null);
        $this->assertParent($in->companyId, $in->parentId, null);
    }

    public function update(Actor $actor, string $accountId, int $version, AccountInput $in): Account
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $accountId, $version, $in) {
            $account = $locks->document(Account::query()->findOrFail($accountId), $version);
            $this->guard->require($actor, 'accounts.manage', $account->company_id, tokens: true);
            $this->assertShape($in);
            $this->assertCodeFree($account->company_id, $in->code, $account->id);
            $this->assertParent($account->company_id, $in->parentId, $account->id);

            $meaningChanged = $account->account_type !== $in->accountType || $account->normal_balance !== $in->normalBalance
                || $account->currency_policy !== $in->currencyPolicy || $account->fixed_currency !== $in->fixedCurrency;
            if ($meaningChanged && JournalLine::query()->where('account_id', $account->id)->exists()) {
                throw DomainRuleViolation::single('account_in_use', 'This account has journal lines, so its type, normal balance and currency policy can no longer change.');
            }

            $before = $account->attributesToArray();
            $account->forceFill([...$this->columns($in), 'lock_version' => $account->lock_version + 1])->save();
            $account->refresh();
            $audit->add('account.updated', $account, before: $before, after: $account);

            return $account;
        });
    }

    public function deactivate(Actor $actor, string $accountId, int $version): Account
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $accountId, $version) {
            $account = $locks->document(Account::query()->findOrFail($accountId), $version);
            $this->guard->require($actor, 'accounts.manage', $account->company_id, tokens: true);
            if (! $account->is_active) {
                throw DomainRuleViolation::single('account_already_inactive', 'The account is already inactive.');
            }

            $before = $account->attributesToArray();
            $account->forceFill(['is_active' => false, 'lock_version' => $account->lock_version + 1])->save();
            $account->refresh();
            $audit->add('account.deactivated', $account, before: $before, after: $account);

            return $account;
        });
    }

    /** @return array<string, mixed> */
    private function columns(AccountInput $in): array
    {
        return [
            'code' => $in->code, 'name' => $in->name, 'account_type' => $in->accountType, 'normal_balance' => $in->normalBalance,
            'account_subtype' => $in->accountSubtype, 'parent_id' => $in->parentId,
            'currency_policy' => $in->currencyPolicy, 'fixed_currency' => $in->fixedCurrency, 'control_type' => $in->controlType,
            'allow_manual_journals' => $in->allowManualJournals, 'is_postable' => $in->isPostable, 'description' => $in->description,
        ];
    }

    private function assertShape(AccountInput $in): void
    {
        if (($in->currencyPolicy === CurrencyPolicy::Fixed) !== ($in->fixedCurrency !== null)) {
            throw DomainRuleViolation::single('account_currency_invalid', 'A fixed-currency account names its currency; every other policy names none.');
        }
    }

    private function assertCodeFree(string $companyId, string $code, ?string $exceptId): void
    {
        // Soft-deleted accounts keep owning their code.
        $query = Account::query()->withTrashed()->where('company_id', $companyId)->where('code', $code);
        if ($exceptId !== null) {
            $query->where('id', '!=', $exceptId);
        }
        if ($query->exists()) {
            throw DomainRuleViolation::single('account_code_taken', "Account code {$code} is already used in this company.");
        }
    }

    /** The parent is another account of the company and must not lead back to this one. */
    private function assertParent(string $companyId, ?string $parentId, ?string $selfId): void
    {
        $hops = 0;
        for ($id = $parentId; $id !== null; $hops++) {
            $parent = Account::query()->where('company_id', $companyId)->find($id);
            if ($parent === null || $id === $selfId || $hops > 50) {
                throw DomainRuleViolation::single('account_parent_invalid', 'The parent must be another account of this company, and not one of this account\'s own children.');
            }
            $id = $parent->parent_id;
        }
    }
}
