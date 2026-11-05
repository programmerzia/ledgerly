<?php

declare(strict_types=1);

namespace App\Queries\Budgets;

use App\Contracts\Clock;
use App\Domain\Budgets\BudgetVariance;
use App\Domain\Reports\ProfitLossSection;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Support\Json;
use App\Models\Budgets\Budget;
use App\Models\Organisation\Company;
use App\Queries\Reports\AccountDirectory;
use App\Queries\Reports\CalendarPeriod;
use App\Queries\Reports\DrillKey;
use App\Queries\Reports\PeriodCalendar;
use App\Queries\Reports\ProfitAndLoss;
use App\Queries\Reports\ReportParams;
use App\Queries\Reports\Variance;
use App\Support\Reports\ReportRunner;

/**
 * Budget vs actual, grouped like the profit and loss (D15 item 5). Both sides are in the account's own direction (income and expense as
 * positive figures). Actuals come from the profit and loss query itself, so year-end closing journals are left out (D7) and a drill
 * key lands on exactly the lines that make the figure. Budget cells are summed over the same periods (the selected month, or the fiscal
 * year to the end of the selected month) and filtered by the same dimension values as the ledger side.
 *
 * Variance = actual − budget; percentage = variance ÷ |budget| to one decimal, half up, on integers (`Variance::pct`), absent when the
 * budget is zero. Favourable: more income or less cost than planned (BudgetVariance); a profit subtotal is favourable when higher.
 * Rows where both the budget and the actual are zero are left out. The result is cached by the ledger version AND the budget's own
 * `lock_version` and status, because a budget edit never changes the ledger version.
 */
final class BudgetVsActual
{
    public function __construct(
        private readonly ReportRunner $runner,
        private readonly ProfitAndLoss $profitAndLoss,
        private readonly AccountDirectory $accounts,
        private readonly PeriodCalendar $calendar,
        private readonly Clock $clock,
    ) {}

    /** The budget a report on $period reads: the one asked for, else the approved version of the period's fiscal year. */
    public function budgetFor(string $companyId, CalendarPeriod $period, ?string $budgetId): Budget
    {
        if ($budgetId !== null) {
            $budget = Budget::query()->where('company_id', $companyId)->whereKey($budgetId)->first()
                ?? throw DomainRuleViolation::single('budget_not_found', 'That budget does not exist in this company.');
            if ($budget->fiscal_year_id !== $period->fiscalYearId) {
                throw DomainRuleViolation::single('budget_year_mismatch', 'That budget is for a different fiscal year than the period.');
            }

            return $budget;
        }

        return Budget::query()->where('company_id', $companyId)->where('fiscal_year_id', $period->fiscalYearId)->where('status', Budget::APPROVED)->first()
            ?? throw DomainRuleViolation::single('budget_not_approved', 'This fiscal year has no approved budget yet. Choose a draft version, or approve one.');
    }

    /** @return array<string, mixed> everything besides the ledger that changes the result */
    public function cacheStamp(Budget $budget): array
    {
        return ['budget_id' => $budget->id, 'budget_version' => $budget->lock_version, 'budget_status' => $budget->status];
    }

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p, Budget $budget): array
    {
        $cur = $p->currency;
        $accounts = $this->accounts->all($p->companyId);
        $planned = $this->budgetAmounts($p, $budget);
        $actual = $this->profitAndLoss->amounts($p, $p->from, $p->to);

        $sections = [];
        $totals = [];
        foreach (ProfitLossSection::cases() as $section) {
            $sections[$section->value] = [];
            $totals[$section->value] = ['budget' => 0, 'actual' => 0];
        }
        foreach ($accounts as $a) {
            $section = ProfitLossSection::of($a->type, $a->subtype);
            if ($section === null) {
                continue;
            }
            $b = $planned[$a->id] ?? 0;
            $x = $actual[$a->id] ?? 0;
            if ($b === 0 && $x === 0) {
                continue;
            }
            $totals[$section->value]['budget'] += $b;
            $totals[$section->value]['actual'] += $x;
            $sections[$section->value][] = [
                'account' => $a->ref() + ['subtype' => $a->subtype, 'account_type' => $a->type],
                ...$this->figure($b, $x, BudgetVariance::higherIsBetter($section), $cur),
                'drill' => DrillKey::make($a->id, $p->from, $p->to, true, $p->dimensionIds),
            ];
        }

        $out = [];
        foreach (ProfitLossSection::cases() as $section) {
            $out[] = [
                'key' => $section->value,
                'title' => $section->title(),
                'lines' => $sections[$section->value],
                'total' => $this->figure($totals[$section->value]['budget'], $totals[$section->value]['actual'], BudgetVariance::higherIsBetter($section), $cur),
            ];
        }

        $profit = fn (string $side, array $keys, array $minus): int => array_sum(array_map(fn (string $k) => $totals[$k][$side], $keys)) - array_sum(array_map(fn (string $k) => $totals[$k][$side], $minus));
        $subtotal = fn (array $plus, array $minus): array => $this->figure($profit('budget', $plus, $minus), $profit('actual', $plus, $minus), true, $cur);

        return [
            'report' => 'budget_vs_actual',
            'currency' => $cur,
            'from' => $p->from,
            'to' => $p->to,
            'basis' => $p->basis,
            'period' => $p->periodId === null ? null : ['id' => $p->periodId, 'name' => $this->calendar->find($p->companyId, $p->periodId)?->name],
            'budget' => ['id' => $budget->id, 'name' => $budget->name, 'revision' => $budget->version, 'status' => $budget->status, 'version' => $budget->lock_version],
            'sections' => $out,
            'subtotals' => [
                'gross_profit' => $subtotal(['operating_revenue'], ['direct_costs']),
                'operating_profit' => $subtotal(['operating_revenue'], ['direct_costs', 'operating_expense']),
                'net_profit' => $subtotal(['operating_revenue', 'other_income'], ['direct_costs', 'operating_expense', 'other_expense']),
            ],
            'filtered' => $p->dims !== [],
        ];
    }

    /**
     * The dashboard note: this fiscal year to date against the approved budget, or null when there is no approved budget (or no current
     * period). Nothing is invented when the company has no budget.
     *
     * @return array<string, mixed>|null
     */
    public function card(Company $company): ?array
    {
        $today = $this->clock->now()->format('Y-m-d');
        $period = $this->calendar->regularContaining($company->id, $today);
        if ($period === null) {
            return null;
        }
        $budget = Budget::query()->where('company_id', $company->id)->where('fiscal_year_id', $period->fiscalYearId)->where('status', Budget::APPROVED)->first();
        if ($budget === null) {
            return null;
        }
        $p = new ReportParams($company->id, $company->base_currency, $period->yearStartsOn, $period->endsOn, 'ytd', 'none', null, [], [], true, $period->id);
        $report = $this->runner->cached($company->id, 'budget_vs_actual', $p->cacheKey() + $this->cacheStamp($budget), fn (): array => ['generated_at' => gmdate('Y-m-d\TH:i:s\Z')] + ($this)($p, $budget));
        $revenue = null;
        foreach ($report['sections'] as $section) {
            if ($section['key'] === 'operating_revenue') {
                $revenue = $section['total'];
            }
        }

        return [
            'budget' => $report['budget'], 'period' => $report['period'], 'basis' => 'ytd', 'from' => $report['from'], 'to' => $report['to'],
            'revenue' => $revenue, 'net_profit' => $report['subtotals']['net_profit'],
        ];
    }

    /** @return array<string, int> account id → budget over the report's periods */
    private function budgetAmounts(ReportParams $p, Budget $budget): array
    {
        $sql = 'SELECT l.account_id, SUM(l.amount)::bigint AS amount FROM budget_lines l JOIN fiscal_periods fp ON fp.id = l.fiscal_period_id '
            .'WHERE l.company_id = ? AND l.budget_id = ? AND fp.kind = \'regular\' AND fp.ends_on <= ?';
        $bindings = [$p->companyId, $budget->id, $p->to];
        if ($p->from !== null) {
            $sql .= ' AND fp.starts_on >= ?';
            $bindings[] = $p->from;
        }
        foreach ($p->dims as $slot => $ids) {
            if ($slot < 1 || $slot > 8 || $ids === []) {
                continue;
            }
            $sql .= " AND l.dim{$slot}_value_id IN (".implode(', ', array_fill(0, count($ids), '?')).')';
            array_push($bindings, ...$ids);
        }
        $out = [];
        foreach ($this->runner->db()->select($sql.' GROUP BY l.account_id', $bindings) as $r) {
            $out[(string) $r->account_id] = (int) $r->amount;
        }

        return $out;
    }

    /**
     * @return array{budget: array{amount: int, currency: string}, actual: array{amount: int, currency: string}, variance: array{amount: int, currency: string}, variance_pct: string|null, favourable: bool|null}
     */
    private function figure(int $budget, int $actual, bool $higherIsBetter, string $currency): array
    {
        return [
            'budget' => Json::money($budget, $currency),
            'actual' => Json::money($actual, $currency),
            'variance' => Json::money($actual - $budget, $currency),
            'variance_pct' => Variance::pct($actual - $budget, $budget),
            'favourable' => BudgetVariance::favourable($budget, $actual, $higherIsBetter),
        ];
    }
}
