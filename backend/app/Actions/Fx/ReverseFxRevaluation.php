<?php

declare(strict_types=1);

namespace App\Actions\Fx;

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Fx\FxRevaluation;
use App\Models\Ledger\Journal;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Support\Facades\Log;

/**
 * The automatic reversal of a revaluation (IAS 21 with auto-reversal, D3): a mirror dated the first day of the
 * next period, posted as the system. It only happens when that period exists and is `open`; otherwise the run
 * stays *pending* (reversal_journal_id null) and is retried by the next run for the company and by the daily
 * rate job. Failure to reverse never fails the run: it is logged and stays pending.
 *
 * Runs as its own transaction, after the run's has committed: the reversal may land in the next fiscal year, whose
 * journal sequence would break the lock order (13 §8) if it shared the run's transaction.
 */
final class ReverseFxRevaluation
{
    public function __construct(private readonly UnitOfWork $uow, private readonly ReverseJournal $reverse) {}

    /** Attempts every pending reversal of the company; returns how many were posted. */
    public function pending(string $tenantId, string $companyId): int
    {
        $done = 0;
        $ids = FxRevaluation::query()->where('company_id', $companyId)->where('status', 'posted')
            ->whereNotNull('journal_id')->whereNull('reversal_journal_id')->orderBy('as_of')->pluck('id');
        foreach ($ids as $id) {
            if ($this->attempt(Actor::system($tenantId, $companyId), (string) $id) !== null) {
                $done++;
            }
        }

        return $done;
    }

    /** The reversal journal, or null while it must wait (no next period, or it is not open). */
    public function attempt(Actor $actor, string $revaluationId): ?Journal
    {
        $run = FxRevaluation::query()->find($revaluationId);
        if ($run === null || ! $run->isReversalPending()) {
            return null;
        }
        $period = FiscalPeriod::query()->findOrFail($run->fiscal_period_id);
        $next = FiscalPeriod::query()->where('company_id', $run->company_id)->where('kind', 'regular')
            ->where('starts_on', '>', $period->ends_on->format('Y-m-d'))->orderBy('starts_on')->first();
        if ($next === null || $next->status !== PeriodStatus::Open) {
            return null;
        }

        try {
            return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $run, $period, $next) {
                // 1: both periods in order, then read the status from the locked row.
                $locked = $locks->periodsById($run->company_id, [$period->id, $next->id]);
                $target = collect($locked)->firstWhere('id', $next->id);
                if ($target === null || $target->status !== PeriodStatus::Open) {
                    return null;
                }
                $journal = Journal::query()->findOrFail((string) $run->journal_id);
                if ($journal->status === JournalStatus::Reversed && $journal->reversed_by_id !== null) {
                    // Someone reversed the revaluation journal by hand: record it instead of posting again.
                    $this->link($run, $journal->reversed_by_id);

                    return Journal::query()->findOrFail($journal->reversed_by_id);
                }

                $reversal = $this->reverse->handle($actor, new ReverseJournalInput(
                    $journal->id, $target->starts_on, memo: "Automatic reversal of the FX revaluation as of {$run->as_of->format('Y-m-d')}",
                ));
                $this->link($run, $reversal->id);
                $audit->add('fx_revaluation.reversed', $run, context: ['reversal_journal_id' => $reversal->id]);

                return $reversal;
            });
        } catch (DomainRuleViolation $e) {
            Log::notice('FX revaluation reversal left pending.', ['revaluation_id' => $run->id, 'code' => $e->errorCode, 'reason' => $e->getMessage()]);

            return null;
        }
    }

    private function link(FxRevaluation $run, string $reversalId): void
    {
        FxRevaluation::query()->whereKey($run->id)->whereNull('reversal_journal_id')->update(['reversal_journal_id' => $reversalId]);
    }
}
