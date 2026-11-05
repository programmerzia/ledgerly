<?php

declare(strict_types=1);

namespace App\Queries\Budgets;

use App\Domain\Budgets\BudgetSpread;
use App\Models\Budgets\Budget;
use App\Queries\Ledger\DimensionPositions;
use App\Queries\Reports\AccountDirectory;
use App\Queries\Reports\LedgerBalances;
use Illuminate\Support\Facades\DB;

/** What the grid editor needs of one budget: its regular periods and its cells, plus the helpers that fill cells (they never save). */
final class BudgetGrid
{
    public function __construct(private readonly LedgerBalances $balances, private readonly AccountDirectory $accounts) {}

    /**
     * @return array{periods: list<array{id: string, number: int, name: string, starts_on: string, ends_on: string}>, lines: list<array{account_id: string, fiscal_period_id: string, dimensions: object, amount: int}>}
     */
    public function __invoke(Budget $budget): array
    {
        $positions = (new DimensionPositions)($budget->company_id);
        $lines = [];
        foreach (DB::table('budget_lines')->where('budget_id', $budget->id)->orderBy('account_id')->orderBy('fiscal_period_id')->get() as $r) {
            $dims = [];
            foreach ($positions as $slot => $dimensionId) {
                $value = $r->{"dim{$slot}_value_id"};
                if (is_string($value)) {
                    $dims[$dimensionId] = $value;
                }
            }
            $lines[] = ['account_id' => (string) $r->account_id, 'fiscal_period_id' => (string) $r->fiscal_period_id, 'dimensions' => (object) $dims, 'amount' => (int) $r->amount];
        }

        return ['periods' => $this->periods($budget), 'lines' => $lines];
    }

    /** @return list<array{id: string, number: int, name: string, starts_on: string, ends_on: string}> */
    public function periods(Budget $budget): array
    {
        $out = [];
        foreach (DB::table('fiscal_periods')->where('fiscal_year_id', $budget->fiscal_year_id)->where('kind', 'regular')->orderBy('number')->get(['id', 'number', 'name', 'starts_on', 'ends_on']) as $p) {
            $out[] = ['id' => (string) $p->id, 'number' => (int) $p->number, 'name' => (string) $p->name, 'starts_on' => (string) $p->starts_on, 'ends_on' => (string) $p->ends_on];
        }

        return $out;
    }

    /**
     * An annual total split over the budget's periods: the same whole share each period, the remainder in the last (BudgetSpread).
     *
     * @return list<array{fiscal_period_id: string, amount: int}>
     */
    public function spread(Budget $budget, int $total): array
    {
        $periods = $this->periods($budget);
        $parts = BudgetSpread::even($total, count($periods));
        $out = [];
        foreach ($periods as $i => $p) {
            $out[] = ['fiscal_period_id' => $p['id'], 'amount' => $parts[$i]];
        }

        return $out;
    }

    /**
     * Cells copied from another budget, matched by period number (so another year works too). Not saved.
     *
     * @return list<array{account_id: string, fiscal_period_id: string, dimensions: object, amount: int}>
     */
    public function fromBudget(Budget $target, Budget $source): array
    {
        $targetPeriods = array_column($this->periods($target), 'id', 'number');
        $sourceNumbers = DB::table('fiscal_periods')->where('fiscal_year_id', $source->fiscal_year_id)->pluck('number', 'id')->all();
        $positions = (new DimensionPositions)($source->company_id);
        $out = [];
        foreach (DB::table('budget_lines')->where('budget_id', $source->id)->get() as $r) {
            $number = $sourceNumbers[(string) $r->fiscal_period_id] ?? null;
            if ($number === null || ! isset($targetPeriods[$number])) {
                continue;
            }
            $dims = [];
            foreach ($positions as $slot => $dimensionId) {
                if (is_string($r->{"dim{$slot}_value_id"})) {
                    $dims[$dimensionId] = $r->{"dim{$slot}_value_id"};
                }
            }
            $out[] = ['account_id' => (string) $r->account_id, 'fiscal_period_id' => $targetPeriods[$number], 'dimensions' => (object) $dims, 'amount' => (int) $r->amount];
        }

        return $out;
    }

    /**
     * Last year's actuals (posted income and expense, closing journals excluded, D7) per account and month, matched to this budget's periods by
     * period number. Without dimension detail. Not saved: the person reviews, adjusts and saves.
     *
     * @return list<array{account_id: string, fiscal_period_id: string, dimensions: object, amount: int}>
     */
    public function fromActuals(Budget $target, string $sourceFiscalYearId): array
    {
        $targetPeriods = array_column($this->periods($target), 'id', 'number');
        $directory = $this->accounts->all($target->company_id);
        $ids = array_keys(array_filter($directory, fn ($a) => in_array($a->type, ['income', 'expense'], true) && $a->postable));
        $out = [];
        foreach (DB::table('fiscal_periods')->where('fiscal_year_id', $sourceFiscalYearId)->where('company_id', $target->company_id)->where('kind', 'regular')->orderBy('number')->get(['number', 'starts_on', 'ends_on']) as $p) {
            if (! isset($targetPeriods[(int) $p->number])) {
                continue;
            }
            foreach ($this->balances->totals($target->company_id, (string) $p->starts_on, (string) $p->ends_on, true, accountIds: $ids === [] ? null : $ids) as $row) {
                $account = $directory[$row->accountId] ?? null;
                if ($account === null || ! in_array($account->type, ['income', 'expense'], true)) {
                    continue;
                }
                $amount = $account->natural($row->debit, $row->credit);
                if ($amount !== 0) {
                    $out[] = ['account_id' => $account->id, 'fiscal_period_id' => $targetPeriods[(int) $p->number], 'dimensions' => (object) [], 'amount' => $amount];
                }
            }
        }

        return $out;
    }
}
