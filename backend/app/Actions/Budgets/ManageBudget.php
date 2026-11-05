<?php

declare(strict_types=1);

namespace App\Actions\Budgets;

use App\Actions\Ledger\SetupGuard;
use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Budgets\Budget;
use App\Models\Budgets\BudgetLine;
use App\Models\Fiscal\FiscalYear;
use App\Models\Organisation\Company;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Budget versions (D15 item 5, `budgets.manage`, people only). A budget never touches the ledger: nothing here posts, locks a period or
 * bumps `ledger_version`. A new budget is always a draft with the next version number of its fiscal year; a revision of an approved budget
 * is a new draft made as a copy of it. Only a draft can be renamed, edited or discarded; an approved one can only be archived.
 */
final class ManageBudget
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly SetupGuard $guard,
    ) {}

    public function create(Actor $actor, string $companyId, string $fiscalYearId, string $name, ?string $copyFromBudgetId = null): Budget
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $companyId, $fiscalYearId, $name, $copyFromBudgetId) {
            $this->guard->require($actor, 'budgets.manage', $companyId);
            // Concurrent creates queue on the company row, so version numbers never collide.
            Company::query()->whereKey($companyId)->lock('FOR NO KEY UPDATE')->firstOrFail();
            $year = FiscalYear::query()->where('company_id', $companyId)->whereKey($fiscalYearId)->first()
                ?? throw DomainRuleViolation::single('fiscal_year_not_found', 'That fiscal year does not exist in this company.');
            $source = null;
            if ($copyFromBudgetId !== null) {
                $source = Budget::query()->where('company_id', $companyId)->whereKey($copyFromBudgetId)->first()
                    ?? throw DomainRuleViolation::single('budget_not_found', 'The budget to copy does not exist in this company.');
            }
            $version = (int) Budget::query()->where('company_id', $companyId)->where('fiscal_year_id', $year->id)->max('version') + 1;

            $budget = new Budget;
            $budget->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $companyId, 'fiscal_year_id' => $year->id,
                'name' => $name, 'version' => $version, 'status' => Budget::DRAFT, 'copied_from_id' => $source?->id, 'created_by' => $actor->id,
            ])->save();
            $budget->refresh();

            $copied = 0;
            if ($source !== null) {
                $copied = $this->copyLines($source, $budget);
            }
            $audit->add('budget.created', $budget, after: $budget, context: ['copied_lines' => $copied]);

            return $budget;
        });
    }

    public function rename(Actor $actor, string $budgetId, int $version, string $name): Budget
    {
        return $this->change($actor, $budgetId, $version, 'budget.renamed', function (Budget $budget) use ($name): void {
            $this->requireDraft($budget);
            $budget->name = $name;
        });
    }

    public function archive(Actor $actor, string $budgetId, int $version): Budget
    {
        return $this->change($actor, $budgetId, $version, 'budget.archived', function (Budget $budget): void {
            if ($budget->status !== Budget::APPROVED) {
                throw DomainRuleViolation::single('budget_not_archivable', 'Only an approved budget is archived. A draft is discarded instead.');
            }
            $budget->status = Budget::ARCHIVED;
            $budget->archived_at = $this->clock->now();
        });
    }

    public function discard(Actor $actor, string $budgetId, int $version): void
    {
        $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $budgetId, $version) {
            $budget = Budget::query()->findOrFail($budgetId);
            $this->guard->require($actor, 'budgets.manage', $budget->company_id);
            $budget = $locks->document($budget, $version);
            $this->requireDraft($budget);
            BudgetLine::query()->where('budget_id', $budget->id)->delete();
            $audit->add('budget.discarded', $budget, before: $budget);
            $budget->delete();
        });
    }

    /** @param \Closure(Budget): void $mutate */
    private function change(Actor $actor, string $budgetId, int $version, string $event, \Closure $mutate): Budget
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $budgetId, $version, $event, $mutate) {
            $budget = Budget::query()->findOrFail($budgetId);
            $this->guard->require($actor, 'budgets.manage', $budget->company_id);
            $budget = $locks->document($budget, $version);
            $before = $budget->attributesToArray();
            $mutate($budget);
            $budget->lock_version++;
            $budget->save();
            $audit->add($event, $budget, before: $before, after: $budget);

            return $budget;
        });
    }

    private function requireDraft(Budget $budget): void
    {
        if ($budget->status !== Budget::DRAFT) {
            throw DomainRuleViolation::single('budget_not_editable', "A {$budget->status} budget is read-only; make a new draft version from it instead.");
        }
    }

    /** Copies every cell of $from into $to; periods are matched by number, so a budget can be copied across fiscal years. */
    private function copyLines(Budget $from, Budget $to): int
    {
        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');

        return $to->getConnection()->affectingStatement(
            'INSERT INTO budget_lines (id, tenant_id, company_id, budget_id, account_id, fiscal_period_id, dim1_value_id, dim2_value_id, dim3_value_id, dim4_value_id, '
            .'dim5_value_id, dim6_value_id, dim7_value_id, dim8_value_id, dim_key, amount, created_at, updated_at) '
            .'SELECT gen_random_uuid(), l.tenant_id, l.company_id, ?, l.account_id, tp.id, l.dim1_value_id, l.dim2_value_id, l.dim3_value_id, l.dim4_value_id, '
            .'l.dim5_value_id, l.dim6_value_id, l.dim7_value_id, l.dim8_value_id, l.dim_key, l.amount, ?, ? '
            ."FROM budget_lines l JOIN fiscal_periods sp ON sp.id = l.fiscal_period_id JOIN fiscal_periods tp ON tp.fiscal_year_id = ? AND tp.number = sp.number AND tp.kind = 'regular' "
            .'WHERE l.budget_id = ?',
            [$to->id, $now, $now, $to->fiscal_year_id, $from->id],
        );
    }
}
