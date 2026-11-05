<?php

declare(strict_types=1);

namespace App\Actions\Budgets;

use App\Actions\Ledger\SetupGuard;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Budgets\Budget;
use App\Models\Budgets\BudgetLine;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Approves a draft budget (`budgets.approve`, people only, and never the person who made it: maker ≠ checker, also a CHECK in the
 * database). A fiscal year has one approved version, so approving a version archives the one approved before it in the same transaction.
 * An approved budget is read-only. The generic document workflow is not used: it routes through thresholds and a signing PIN for
 * ledger documents, and a budget posts nothing; the permission and the maker-checker rule are the control (flagged in the plan notes).
 */
final class ApproveBudget
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly Clock $clock) {}

    public function handle(Actor $actor, string $budgetId, int $version): Budget
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $budgetId, $version) {
            $budget = Budget::query()->findOrFail($budgetId);
            $this->guard->require($actor, 'budgets.approve', $budget->company_id);
            $budget = $locks->document($budget, $version);
            if ($budget->status !== Budget::DRAFT) {
                throw DomainRuleViolation::single('budget_not_draft', "A {$budget->status} budget cannot be approved.");
            }
            if ($actor->id === null || $budget->created_by === null || $actor->id === $budget->created_by) {
                throw DomainRuleViolation::single('self_approval_forbidden', 'A budget is approved by someone other than the person who made it.');
            }
            if (! BudgetLine::query()->where('budget_id', $budget->id)->exists()) {
                throw DomainRuleViolation::single('budget_empty', 'A budget with no amounts cannot be approved.');
            }

            // Two approvals for one year queue on the company row, so the second one archives the first instead of colliding with it.
            Company::query()->whereKey($budget->company_id)->lock('FOR NO KEY UPDATE')->firstOrFail();
            $now = $this->clock->now();
            $previous = Budget::query()->where('company_id', $budget->company_id)->where('fiscal_year_id', $budget->fiscal_year_id)
                ->where('status', Budget::APPROVED)->where('id', '<>', $budget->id)->lock('FOR UPDATE')->get();
            foreach ($previous as $old) {
                $before = $old->attributesToArray();
                $old->forceFill(['status' => Budget::ARCHIVED, 'archived_at' => $now, 'lock_version' => $old->lock_version + 1])->save();
                $audit->add('budget.archived', $old, before: $before, after: $old, context: ['superseded_by' => $budget->id]);
            }

            $before = $budget->attributesToArray();
            $budget->forceFill(['status' => Budget::APPROVED, 'approved_by' => $actor->id, 'approved_at' => $now, 'lock_version' => $budget->lock_version + 1])->save();
            $audit->add('budget.approved', $budget, before: $before, after: $budget);

            return $budget;
        });
    }
}
