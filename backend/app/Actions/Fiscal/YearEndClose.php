<?php

declare(strict_types=1);

namespace App\Actions\Fiscal;

use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\RecordJournal;
use App\Actions\Ledger\ReverseJournal;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Fiscal\FiscalYearClosed;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fiscal\FiscalYear;
use App\Models\Ledger\Account;
use App\Models\Ledger\AccountPeriodBalance;
use App\Models\Ledger\Journal;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Year-end close (D7). Requires every regular period of the year to be closed; locks them and the
 * adjustment period FOR UPDATE; reverses a previous closing journal if there is one; then posts one
 * `closing` journal into the adjustment period that moves each income and expense account's net
 * balance, per dimension combination, to retained earnings. The year becomes `closed`.
 */
final class YearEndClose
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly FiscalGuard $guard,
        private readonly ReverseJournal $reverse,
        private readonly RecordJournal $record,
    ) {}

    public function handle(Actor $actor, string $fiscalYearId): ?Journal
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $fiscalYearId) {
            $year = FiscalYear::query()->find($fiscalYearId) ?? throw DomainRuleViolation::single('not_found', 'The fiscal year does not exist.');
            $this->guard->require($actor, 'periods.year_end', $year->company_id, signed: true);

            $ids = array_values(array_map(strval(...), FiscalPeriod::query()->where('fiscal_year_id', $year->id)->pluck('id')->all()));
            $periods = $locks->periodsById($year->company_id, $ids, forUpdate: true);
            $year = FiscalYear::query()->whereKey($year->id)->lockForUpdate()->firstOrFail();
            if ($year->status === 'locked') {
                throw DomainRuleViolation::single('fiscal_year_locked', 'The year is locked.');
            }
            $adjustment = null;
            $open = [];
            foreach ($periods as $p) {
                if ($p->kind === 'adjustment') {
                    $adjustment = $p;
                } elseif ($p->status !== PeriodStatus::Closed) {
                    $open[] = $p->name;
                }
            }
            if ($open !== []) {
                throw DomainRuleViolation::single('periods_not_closed', 'Close every month of the year first: '.implode(', ', $open).'.');
            }
            if ($adjustment === null) {
                throw DomainRuleViolation::single('adjustment_period_missing', 'The year has no adjustment period.');
            }

            $previous = Journal::query()->where('fiscal_period_id', $adjustment->id)->where('journal_type', JournalType::Closing)
                ->where('status', JournalStatus::Posted)->whereNull('reversal_of_id')->orderBy('posted_at')->get();
            foreach ($previous as $old) {
                $this->reverse->handle($actor, new ReverseJournalInput($old->id, memo: 'Year-end close re-run'));
            }

            $lines = $this->closingLines($year->company_id, $ids);
            $journal = null;
            if ($lines !== []) {
                $journal = $this->record->handle($actor, new RecordJournalInput(new JournalDraft(
                    $year->company_id, JournalType::Closing, $adjustment->ends_on, $lines,
                    reference: "YE-{$year->name}", memo: "Year-end close {$year->name}: income and expenses to retained earnings",
                    sourceType: 'fiscal_years', sourceId: $year->id,
                ), $adjustment->id));
            }

            $before = $year->attributesToArray();
            $year->forceFill(['status' => 'closed'])->save();
            $audit->add('fiscal_year.closed', $year, before: $before, after: $year, context: ['closing_journal_id' => $journal?->id, 'reversed' => $previous->pluck('id')->all()]);
            $outbox->add(new FiscalYearClosed($year->company_id, $year->id, ['closing_journal_id' => $journal?->id]));

            return $journal;
        });
    }

    /**
     * Net of every income/expense account per dimension set over the year's periods (closing
     * reversals included, so a re-run starts from the true balances), closed against retained
     * earnings with the same dimensions.
     *
     * @param  list<string>  $periodIds
     * @return list<DraftLine>
     */
    private function closingLines(string $companyId, array $periodIds): array
    {
        $retained = Account::query()->where('company_id', $companyId)->where('control_type', ControlType::RetainedEarnings)->get();
        if ($retained->count() !== 1) {
            throw DomainRuleViolation::single('retained_earnings_missing', 'The chart needs exactly one retained earnings account.');
        }
        $re = (string) $retained->first()?->id;

        $dimCols = array_map(fn (int $p) => "b.dim{$p}_value_id", range(1, 8));
        $rows = AccountPeriodBalance::query()->from('account_period_balances as b')
            ->join('accounts as a', 'a.id', '=', 'b.account_id')
            ->where('b.company_id', $companyId)->whereIn('b.fiscal_period_id', $periodIds)->whereIn('a.account_type', ['income', 'expense'])
            ->groupBy('b.account_id', ...$dimCols)->orderBy('b.account_id')
            ->selectRaw('b.account_id, '.implode(', ', $dimCols).', SUM(b.debit) - SUM(b.credit) AS net')
            ->toBase()->get();

        $lines = [];
        $toRetained = [];
        foreach ($rows as $row) {
            $net = (int) $row->net;
            if ($net === 0) {
                continue;
            }
            $dims = [];
            foreach (range(1, 8) as $p) {
                $dims[$p] = $row->{"dim{$p}_value_id"};
            }
            $lines[] = new DraftLine((string) $row->account_id, debit: max(0, -$net), credit: max(0, $net), dims: $dims, description: 'Close to retained earnings');
            $key = implode('|', array_map(fn ($v) => (string) $v, $dims));
            $toRetained[$key] = ['dims' => $dims, 'net' => ($toRetained[$key]['net'] ?? 0) + $net];
        }
        ksort($toRetained);
        foreach ($toRetained as $group) {
            if ($group['net'] !== 0) {
                $lines[] = new DraftLine($re, debit: max(0, $group['net']), credit: max(0, -$group['net']), dims: $group['dims'], description: 'Result for the year');
            }
        }

        return $lines;
    }
}
