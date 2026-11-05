<?php

declare(strict_types=1);

namespace App\Actions\Budgets;

use App\Actions\Ledger\SetupGuard;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Budgets\Budget;
use App\Services\Budgets\BudgetLineWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Saves cells of a draft budget (`budgets.manage`, people only), all or none, against the version the editor loaded. Every save bumps the
 * budget's `lock_version`, which is also part of the budget vs actual cache key. Never touches the ledger.
 */
final class SaveBudgetLines
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly BudgetLineWriter $writer) {}

    /**
     * @param  list<array{account_id: string, fiscal_period_id: string, dimensions?: array<string, string>, amount: int}>  $cells
     * @return array{budget: Budget, written: int, deleted: int}
     */
    public function handle(Actor $actor, string $budgetId, int $version, array $cells): array
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $budgetId, $version, $cells) {
            $budget = Budget::query()->findOrFail($budgetId);
            $this->guard->require($actor, 'budgets.manage', $budget->company_id);
            $budget = $locks->document($budget, $version);
            if ($budget->status !== Budget::DRAFT) {
                throw DomainRuleViolation::single('budget_not_editable', "A {$budget->status} budget is read-only; make a new draft version from it instead.");
            }

            $result = $this->writer->apply($budget, $cells);
            $before = $budget->attributesToArray();
            $budget->lock_version++;
            $budget->save();
            $audit->add('budget.lines_saved', $budget, before: $before, after: $budget, context: $result);

            return ['budget' => $budget] + $result;
        });
    }
}
