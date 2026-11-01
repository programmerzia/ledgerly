<?php

declare(strict_types=1);

namespace App\Policies\Ledger;

use App\Models\Ledger\Account;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/** Chart of accounts (13 §7). Tokens: `accounts:read` and `accounts:write`; applying a template is for people. */
final class AccountPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'accounts.view', 'accounts:read');
    }

    public function view(Authenticatable $principal, Account $account): bool
    {
        return $this->context->can($principal, 'accounts.view', 'accounts:read', $account->company_id);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'accounts.manage', 'accounts:write');
    }

    public function update(Authenticatable $principal, Account $account): bool
    {
        return $this->context->can($principal, 'accounts.manage', 'accounts:write', $account->company_id);
    }

    public function deactivate(Authenticatable $principal, Account $account): bool
    {
        return $account->is_active && $this->update($principal, $account);
    }

    /** Chart templates: onboarding, a person's decision. */
    public function applyTemplate(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'accounts.manage');
    }
}
