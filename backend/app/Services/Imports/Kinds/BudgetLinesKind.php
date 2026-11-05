<?php

declare(strict_types=1);

namespace App\Services\Imports\Kinds;

use App\Actions\Budgets\SaveBudgetLines;
use App\Domain\Banking\AmountParser;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Budgets\Budget;
use App\Models\Organisation\Company;
use App\Services\Budgets\BudgetLineWriter;
use App\Services\Imports\FieldSpec;
use App\Services\Imports\ImportContext;
use App\Services\Imports\ImportKind;
use App\Services\Imports\ImportRunner;
use App\Services\Imports\PreparedSet;
use App\Services\Imports\RowOutcome;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use InvalidArgumentException;

/**
 * Budget amounts into one DRAFT budget (`options.budget_id`), one amount per row: account code, period, amount, and optionally dimension
 * values. A file that repeats an account + period + dimensions is an error on the later row. Whatever a row names is checked by the same
 * writer the grid uses (income and expense accounts that take postings, periods of the budget's year, dimension values of the named
 * dimension), the whole file is applied together or not at all, and a cell already in the budget is replaced by the file's amount.
 * Amounts are in the company base currency's own units, read with the import's number locale. The period is its number in the year (1, 2,
 * ...), its name, or any date inside it.
 */
final class BudgetLinesKind extends ImportKind
{
    public function __construct(private readonly BudgetLineWriter $writer, private readonly SaveBudgetLines $save) {}

    public function key(): string
    {
        return 'budget_lines';
    }

    public function permission(): string
    {
        return 'budgets.manage';
    }

    public function atomic(): bool
    {
        return true;
    }

    public function fields(): array
    {
        return [
            new FieldSpec('account', 'Account code', true, ['account', 'account number', 'code', 'acct']),
            new FieldSpec('period', 'Period', true, ['month', 'period number', 'period name', 'date'], 'its number in the fiscal year (1, 2, ...), its name, or a date inside it'),
            new FieldSpec('amount', 'Amount', true, ['budget', 'budget amount', 'planned', 'value'], 'in the company currency, in the account\'s own direction (income and expense both positive)'),
            new FieldSpec('dimensions', 'Dimensions', false, ['dimension', 'dimension values'], 'DIMENSION=VALUE, several separated by semicolons'),
        ];
    }

    public function optionRules(Company $company): array
    {
        return ['budget_id' => ['required', 'uuid', Rule::exists('budgets', 'id')->where('company_id', $company->id)]];
    }

    public function missingOptions(array $options): array
    {
        return isset($options['budget_id']) ? [] : ['budget_id'];
    }

    public function prepare(ImportContext $ctx, array $rows): PreparedSet
    {
        $set = new PreparedSet;
        $budget = Budget::query()->where('company_id', $ctx->company->id)->find((string) $ctx->option('budget_id'));
        if ($budget === null) {
            $set->fileErrors[] = ['code' => 'budget_not_found', 'message' => 'The budget for this import does not exist.'];

            return $set;
        }
        if ($budget->status !== Budget::DRAFT) {
            $set->fileErrors[] = ['code' => 'budget_not_editable', 'message' => "A {$budget->status} budget is read-only; import into a draft version."];
        }

        $periods = [];
        foreach (DB::table('fiscal_periods')->where('fiscal_year_id', $budget->fiscal_year_id)->where('kind', 'regular')->orderBy('number')->get(['id', 'number', 'name', 'starts_on', 'ends_on']) as $p) {
            $periods[] = ['id' => (string) $p->id, 'number' => (int) $p->number, 'name' => trim((string) $p->name), 'starts_on' => (string) $p->starts_on, 'ends_on' => (string) $p->ends_on];
        }
        $dimensions = [];
        foreach (DB::table('dimensions')->where('company_id', $ctx->company->id)->get(['id', 'code']) as $d) {
            $dimensions[strtolower((string) $d->code)] = (string) $d->id;
        }
        $values = [];
        foreach (DB::table('dimension_values')->where('company_id', $ctx->company->id)->get(['id', 'dimension_id', 'code']) as $v) {
            $values[$v->dimension_id.'|'.strtolower((string) $v->code)] = (string) $v->id;
        }

        $cells = [];
        $rowOfCell = [];
        $seen = [];
        foreach ($rows as $number => $cells0) {
            $outcome = new RowOutcome;
            $cell = $this->cell($ctx, $cells0, $outcome, $periods, $dimensions, $values);
            if ($cell !== null) {
                $key = $cell['account_id'].'|'.$cell['fiscal_period_id'].'|'.json_encode($cell['dimensions'] ?? []);
                if (isset($seen[$key])) {
                    $outcome->add(null, 'duplicate_in_file', "This account, period and dimensions already appear on row {$seen[$key]}.");
                } else {
                    $seen[$key] = $number;
                    $cells[] = $cell;
                    $rowOfCell[] = $number;
                }
            }
            $set->rows[$number] = $outcome;
        }

        // The writer's own rules, once over the whole file; its cell numbers map back to rows.
        try {
            $this->writer->prepare($budget, $cells);
        } catch (DomainRuleViolation $e) {
            foreach ($e->violations as $v) {
                $row = $v->lineNo !== null ? ($rowOfCell[$v->lineNo - 1] ?? null) : null;
                $message = preg_replace('/^Cell \d+: /', '', $v->message) ?? $v->message;
                if ($row !== null) {
                    $set->rows[$row]->add($v->code === 'budget_account_not_found' || str_starts_with($v->code, 'budget_account') ? 'account' : null, $v->code, $message);
                } else {
                    $set->fileErrors[] = ['code' => $v->code, 'message' => $message];
                }
            }
        }
        $set->summary = ['budget' => $budget->name, 'revision' => $budget->version, 'cells' => count($cells), 'total' => array_sum(array_column($cells, 'amount'))];

        return $set;
    }

    public function apply(ImportContext $ctx, Actor $actor, ImportRunner $run): void
    {
        $rows = $run->pending();
        if ($rows->isEmpty()) {
            return;
        }
        $run->unit(ImportRunner::ids($rows), function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($ctx, $actor, $rows): array {
            // Re-read the world: the budget may have been approved or edited since the preview.
            $fresh = $this->prepare($ctx, $rows->mapWithKeys(fn ($r) => [$r->row_number => $r->cells])->all());
            $problems = $fresh->fileErrors;
            foreach ($fresh->rows as $number => $outcome) {
                foreach ($outcome->errors as $e) {
                    $problems[] = ['code' => $e['code'], 'message' => "Row {$number}: {$e['message']}"];
                }
            }
            if ($problems !== []) {
                throw new DomainRuleViolation($problems[0]['code'], 'The budget file no longer passes validation: '.$problems[0]['message']);
            }
            $budget = Budget::query()->findOrFail((string) $ctx->option('budget_id'));
            $cells = [];
            foreach ($fresh->rows as $outcome) {
                $cells[] = $outcome->prepared;
            }
            $result = $this->save->handle($actor, $budget->id, $budget->lock_version, $cells);

            return ['budget_id' => $budget->id, 'cells' => $result['written'] + $result['deleted']];
        });
    }

    /**
     * @param  array<string, string>  $cells
     * @param  list<array{id: string, number: int, name: string, starts_on: string, ends_on: string}>  $periods
     * @param  array<string, string>  $dimensions  lower-case dimension code → id
     * @param  array<string, string>  $values  "dimension id|lower-case value code" → id
     * @return array{account_id: string, fiscal_period_id: string, dimensions?: array<string, string>, amount: int}|null
     */
    private function cell(ImportContext $ctx, array $cells, RowOutcome $outcome, array $periods, array $dimensions, array $values): ?array
    {
        $code = $ctx->value($cells, 'account');
        $account = $code === null ? null : $ctx->account($code);
        if ($code === null) {
            $outcome->add('account', 'required', 'The account code is empty.');
        } elseif ($account === null) {
            $outcome->add('account', 'code_not_found', "There is no account with code {$code} in this company.");
        }

        $periodId = null;
        $rawPeriod = $ctx->value($cells, 'period');
        if ($rawPeriod === null) {
            $outcome->add('period', 'required', 'The period is empty.');
        } else {
            $periodId = $this->period($rawPeriod, $periods);
            if ($periodId === null) {
                $outcome->add('period', 'period_not_found', "{$rawPeriod} is not a period of this budget's fiscal year (use its number, its name or a date inside it).");
            }
        }

        $amount = 0;
        $rawAmount = $ctx->value($cells, 'amount');
        if ($rawAmount === null) {
            $outcome->add('amount', 'required', 'The amount is empty.');
        } else {
            try {
                $amount = AmountParser::parse($rawAmount, $ctx->locale(), $ctx->scale());
            } catch (InvalidArgumentException $e) {
                $outcome->add('amount', 'invalid_amount', $e->getMessage());
            }
        }

        $dims = [];
        $rawDims = $ctx->value($cells, 'dimensions');
        if ($rawDims !== null) {
            foreach (array_filter(array_map('trim', explode(';', $rawDims))) as $pair) {
                [$d, $v] = array_pad(array_map('trim', explode('=', $pair, 2)), 2, '');
                $dimension = $dimensions[strtolower($d)] ?? null;
                $value = $dimension === null ? null : ($values[$dimension.'|'.strtolower($v)] ?? null);
                if ($dimension === null || $value === null || $v === '') {
                    $outcome->add('dimensions', 'dimension_value_invalid', "{$pair} is not a dimension and value of this company (write DIMENSION=VALUE, using their codes).");

                    continue;
                }
                $dims[$dimension] = $value;
            }
        }
        if (! $outcome->ok() || $account === null || $periodId === null) {
            return null;
        }
        $cell = ['account_id' => $account->id, 'fiscal_period_id' => $periodId, 'amount' => $amount];
        if ($dims !== []) {
            $cell['dimensions'] = $dims;
        }
        $outcome->prepared = $cell;

        return $cell;
    }

    /** @param list<array{id: string, number: int, name: string, starts_on: string, ends_on: string}> $periods */
    private function period(string $raw, array $periods): ?string
    {
        if (ctype_digit($raw)) {
            foreach ($periods as $p) {
                if ($p['number'] === (int) $raw) {
                    return $p['id'];
                }
            }

            return null;
        }
        foreach ($periods as $p) {
            if (strcasecmp($p['name'], $raw) === 0) {
                return $p['id'];
            }
        }
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $raw) === 1) {
            foreach ($periods as $p) {
                if ($p['starts_on'] <= $raw && $p['ends_on'] >= $raw) {
                    return $p['id'];
                }
            }
        }

        return null;
    }
}
