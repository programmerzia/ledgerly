<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Models\Ledger\Account;

/** One account with its dimension rules. */
final class ShowAccount
{
    public function __invoke(string $accountId): Account
    {
        return Account::query()->with('dimensionRules')->findOrFail($accountId);
    }
}
