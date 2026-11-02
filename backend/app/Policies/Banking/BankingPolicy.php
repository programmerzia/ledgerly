<?php

declare(strict_types=1);

namespace App\Policies\Banking;

use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Banking (13 §7) for every banking model. Tokens: `banking:read` reads; `banking:write` may import statements (data in, not a
 * posting). Everything else is a person's: matching and reconciling (`banking.reconcile`), coding lines (`banking.transactions.create`,
 * which posts), rules (`banking.rules.manage`), and bank accounts (`accounts.manage`, they pick the ledger account).
 */
final class BankingPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->can($principal, 'banking.view', 'banking:read');
    }

    public function view(Authenticatable $principal, mixed $subject = null): bool
    {
        return $this->viewAny($principal);
    }

    public function manageAccounts(Authenticatable $principal, mixed $subject = null): bool
    {
        return $this->context->personCan($principal, 'accounts.manage');
    }

    public function import(Authenticatable $principal, mixed $subject = null): bool
    {
        return $this->context->can($principal, 'banking.reconcile', 'banking:write');
    }

    public function reconcile(Authenticatable $principal, mixed $subject = null): bool
    {
        return $this->context->personCan($principal, 'banking.reconcile');
    }

    public function codeLines(Authenticatable $principal, mixed $subject = null): bool
    {
        return $this->context->personCan($principal, 'banking.transactions.create');
    }

    public function manageRules(Authenticatable $principal, mixed $subject = null): bool
    {
        return $this->context->personCan($principal, 'banking.rules.manage');
    }
}
