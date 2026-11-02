<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Models\Ledger\Account;
use Illuminate\Database\Eloquent\Builder;

/** The company's chart of accounts, filtered; the caller paginates (by code). */
final class ListAccounts
{
    /** @return Builder<Account> */
    public function __invoke(string $companyId, ?string $type = null, ?bool $active = null, ?string $search = null): Builder
    {
        $query = Account::query()->with('dimensionRules')->where('company_id', $companyId);
        if ($type !== null) {
            $query->where('account_type', $type);
        }
        if ($active !== null) {
            $query->where('is_active', $active);
        }
        if ($search !== null && trim($search) !== '') {
            $like = '%'.addcslashes(trim($search), '\\%_').'%';
            $query->where(fn (Builder $q) => $q->where('code', 'ilike', $like)->orWhere('name', 'ilike', $like));
        }

        return $query;
    }
}
