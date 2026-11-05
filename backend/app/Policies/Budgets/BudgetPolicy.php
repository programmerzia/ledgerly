<?php

declare(strict_types=1);

namespace App\Policies\Budgets;

use App\Models\Budgets\Budget;
use App\Policies\PolicyContext;
use Illuminate\Contracts\Auth\Authenticatable;

/**
 * Budgets (`budgets.view|manage|approve`). Budgets are people's work: API tokens carry no budget abilities. Approval is by someone other
 * than the maker (the Action and the database check it as well; here it only drives the `can` hint).
 */
final class BudgetPolicy
{
    public function __construct(private readonly PolicyContext $context) {}

    public function viewAny(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'budgets.view');
    }

    public function view(Authenticatable $principal, Budget $budget): bool
    {
        return $this->context->personCan($principal, 'budgets.view', $budget->company_id);
    }

    public function create(Authenticatable $principal): bool
    {
        return $this->context->personCan($principal, 'budgets.manage');
    }

    public function update(Authenticatable $principal, Budget $budget): bool
    {
        return $budget->status === Budget::DRAFT && $this->context->personCan($principal, 'budgets.manage', $budget->company_id);
    }

    public function discard(Authenticatable $principal, Budget $budget): bool
    {
        return $this->update($principal, $budget);
    }

    public function archive(Authenticatable $principal, Budget $budget): bool
    {
        return $budget->status === Budget::APPROVED && $this->context->personCan($principal, 'budgets.manage', $budget->company_id);
    }

    public function approve(Authenticatable $principal, Budget $budget): bool
    {
        return $budget->status === Budget::DRAFT
            && $principal->getAuthIdentifier() !== $budget->created_by
            && $this->context->personCan($principal, 'budgets.approve', $budget->company_id);
    }
}
