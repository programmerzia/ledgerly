<?php

declare(strict_types=1);

namespace App\Services\Budgets;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\DimKey;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Models\Budgets\Budget;
use Illuminate\Support\Facades\DB;

/**
 * Validates and writes budget cells (D15 item 5). Used by the Action that edits a draft and by the spreadsheet import, so both enforce
 * the same rules: only income and expense accounts that take postings (the mock and PRD 4.11 budget the profit and loss; a balance sheet
 * budget is not provided), only the regular periods of the budget's own fiscal year, dimension values that belong to the named
 * dimension and are active, whole minor units. A zero amount deletes the cell, so the grid stays sparse. Not transactional by itself:
 * call it inside a UnitOfWork.
 */
final class BudgetLineWriter
{
    public const int MAX_AMOUNT = 999_999_999_999_999;

    public const int MAX_CELLS = 20000;

    public function __construct(private readonly IdGenerator $ids, private readonly Clock $clock) {}

    /**
     * @param  list<array{account_id: string, fiscal_period_id: string, dimensions?: array<string, string>, amount: int}>  $cells
     * @return array{written: int, deleted: int}
     */
    public function apply(Budget $budget, array $cells): array
    {
        if (count($cells) > self::MAX_CELLS) {
            throw DomainRuleViolation::single('budget_too_many_cells', 'Save at most '.self::MAX_CELLS.' cells at a time.');
        }
        $prepared = $this->prepare($budget, $cells);

        $now = $this->clock->now()->format('Y-m-d H:i:s.uP');
        $written = 0;
        $deleted = 0;
        $upserts = [];
        foreach ($prepared as $cell) {
            if ($cell['amount'] === 0) {
                $deleted += DB::delete(
                    'DELETE FROM budget_lines WHERE budget_id = ? AND account_id = ? AND fiscal_period_id = ? AND dim_key = decode(?, \'hex\')',
                    [$budget->id, $cell['account_id'], $cell['period_id'], $cell['dim_key']],
                );
            } else {
                $upserts[] = $cell;
            }
        }
        foreach (array_chunk($upserts, 500) as $chunk) {
            $marks = [];
            $bindings = [];
            foreach ($chunk as $cell) {
                $marks[] = '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, decode(?, \'hex\'), ?, ?, ?)';
                array_push($bindings, $this->ids->next(), $budget->tenant_id, $budget->company_id, $budget->id, $cell['account_id'], $cell['period_id']);
                for ($p = 1; $p <= 8; $p++) {
                    $bindings[] = $cell['dims'][$p] ?? null;
                }
                array_push($bindings, $cell['dim_key'], $cell['amount'], $now, $now);
            }
            DB::statement(
                'INSERT INTO budget_lines (id, tenant_id, company_id, budget_id, account_id, fiscal_period_id, dim1_value_id, dim2_value_id, dim3_value_id, dim4_value_id, '
                .'dim5_value_id, dim6_value_id, dim7_value_id, dim8_value_id, dim_key, amount, created_at, updated_at) VALUES '
                .implode(', ', $marks)
                .' ON CONFLICT (budget_id, account_id, fiscal_period_id, dim_key) DO UPDATE SET amount = EXCLUDED.amount, updated_at = EXCLUDED.updated_at',
                $bindings,
            );
            $written += count($chunk);
        }

        return ['written' => $written, 'deleted' => $deleted];
    }

    /**
     * @param  list<array{account_id: string, fiscal_period_id: string, dimensions?: array<string, string>, amount: int}>  $cells
     * @return list<array{account_id: string, period_id: string, dims: array<int, string>, dim_key: string, amount: int}>
     */
    public function prepare(Budget $budget, array $cells): array
    {
        $accountIds = array_values(array_unique(array_map(fn (array $c) => $c['account_id'], $cells)));
        $periodIds = array_values(array_unique(array_map(fn (array $c) => $c['fiscal_period_id'], $cells)));
        $accounts = $accountIds === [] ? [] : DB::table('accounts')->where('company_id', $budget->company_id)->whereNull('deleted_at')->whereIn('id', $accountIds)->get(['id', 'account_type', 'is_postable', 'is_active', 'code'])->keyBy('id')->all();
        $periods = $periodIds === [] ? [] : DB::table('fiscal_periods')->where('company_id', $budget->company_id)->where('fiscal_year_id', $budget->fiscal_year_id)->where('kind', 'regular')->whereIn('id', $periodIds)->pluck('id')->flip()->all();
        $positions = DB::table('dimensions')->where('company_id', $budget->company_id)->pluck('position', 'id')->all();
        $valueIds = [];
        foreach ($cells as $c) {
            foreach ($c['dimensions'] ?? [] as $v) {
                $valueIds[$v] = true;
            }
        }
        $values = $valueIds === [] ? [] : DB::table('dimension_values')->where('company_id', $budget->company_id)->whereIn('id', array_keys($valueIds))->get(['id', 'dimension_id', 'is_active'])->keyBy('id')->all();

        $violations = [];
        $out = [];
        foreach ($cells as $i => $c) {
            $n = $i + 1;
            $account = $accounts[$c['account_id']] ?? null;
            if ($account === null) {
                $violations[] = new Violation('budget_account_not_found', "Cell {$n}: the account does not exist in this company.", $n);

                continue;
            }
            if (! in_array($account->account_type, ['income', 'expense'], true)) {
                $violations[] = new Violation('budget_account_type_invalid', "Cell {$n}: {$account->code} is not an income or expense account; budgets cover the profit and loss only.", $n);

                continue;
            }
            if (! $account->is_postable) {
                $violations[] = new Violation('budget_account_not_postable', "Cell {$n}: {$account->code} is a header account; budget its postable accounts.", $n);

                continue;
            }
            if (! isset($periods[$c['fiscal_period_id']])) {
                $violations[] = new Violation('budget_period_invalid', "Cell {$n}: the period is not a regular period of this budget's fiscal year.", $n);

                continue;
            }
            if (abs($c['amount']) > self::MAX_AMOUNT) {
                $violations[] = new Violation('amount_out_of_range', "Cell {$n}: the amount is too large.", $n);

                continue;
            }
            $dims = [];
            $bad = false;
            foreach ($c['dimensions'] ?? [] as $dimensionId => $valueId) {
                $value = $values[$valueId] ?? null;
                if (! isset($positions[$dimensionId]) || $value === null || $value->dimension_id !== $dimensionId || ! $value->is_active) {
                    $violations[] = new Violation('dimension_value_invalid', "Cell {$n}: the dimension value does not belong to that dimension, or is inactive.", $n);
                    $bad = true;

                    break;
                }
                $dims[(int) $positions[$dimensionId]] = $valueId;
            }
            if ($bad) {
                continue;
            }
            $key = bin2hex(DimKey::of($dims));
            // Later cells win over earlier ones for the same account, period and dimensions.
            $out[$c['account_id'].'|'.$c['fiscal_period_id'].'|'.$key] = ['account_id' => $c['account_id'], 'period_id' => $c['fiscal_period_id'], 'dims' => $dims, 'dim_key' => $key, 'amount' => $c['amount']];
        }
        if ($violations !== []) {
            throw new DomainRuleViolation($violations[0]->code, $violations[0]->message, array_slice($violations, 0, 500));
        }

        return array_values($out);
    }
}
