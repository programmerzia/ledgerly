<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Models\Ledger\Account;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Shows or hides an account in default lists and pickers (`accounts.manage`). Hiding is presentation only: a hidden
 * account still posts, reports and keeps its balance, and the ledger invariants never look at the flag. Asking for
 * the state the account is already in changes nothing and writes no audit event.
 */
final class SetAccountHidden
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard) {}

    public function handle(Actor $actor, string $accountId, int $version, bool $hidden): Account
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $accountId, $version, $hidden) {
            $account = $locks->document(Account::query()->findOrFail($accountId), $version);
            $this->guard->require($actor, 'accounts.manage', $account->company_id, tokens: true);

            if ($account->is_hidden === $hidden) {
                return $account;
            }

            $before = $account->attributesToArray();
            $account->forceFill(['is_hidden' => $hidden, 'lock_version' => $account->lock_version + 1])->save();
            $account->refresh();
            $audit->add($hidden ? 'account.hidden' : 'account.shown', $account, before: $before, after: $account);

            return $account;
        });
    }
}
