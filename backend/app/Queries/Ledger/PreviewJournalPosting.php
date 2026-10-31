<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Domain\Ledger\PostingRejected;
use App\Domain\Ledger\PostingValidator;
use App\Domain\Shared\Violation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;

/**
 * Runs the posting validator over a draft without locks or side effects: the same rules and codes
 * as `PostJournal` (13 §9), used by the preview endpoint and by `SubmitDocument` to fail early.
 * The number is never predicted; it is allocated gaplessly only when the posting commits.
 */
final class PreviewJournalPosting
{
    public function __construct(private readonly PostingEngine $engine, private readonly PostingValidator $validator) {}

    public function of(Actor $actor, string $journalId): PostingPreview
    {
        $journal = Journal::query()->with('lines')->findOrFail($journalId);
        $company = Company::query()->findOrFail($journal->company_id);
        $period = $this->periodFor($journal);
        $draft = $this->engine->draftOf($journal, $company->base_currency);
        $ctx = $this->engine->context($actor, $draft, $period);

        $violations = [];
        $totals = [0, 0];
        if ($period === null) {
            $violations[] = new Violation('period_missing', 'No fiscal period covers the journal date.');
        } else {
            try {
                $plan = $this->validator->validate($draft, $ctx);
                $totals = [$plan->totalDebit, $plan->totalCredit];
            } catch (PostingRejected $e) {
                $violations = $e->violations;
            }
        }

        return new PostingPreview(
            $violations === [], $violations,
            $period?->id, $period?->name, $period?->status->value,
            $totals[0], $totals[1],
        );
    }

    /** Unlocked twin of PostingEngine::lockPeriod. */
    private function periodFor(Journal $journal): ?FiscalPeriod
    {
        if ($journal->fiscal_period_id !== null) {
            return FiscalPeriod::query()->where('company_id', $journal->company_id)->find($journal->fiscal_period_id);
        }
        if ($journal->journal_type->isAdjustmentPeriodType()) {
            return null;
        }

        return FiscalPeriod::query()->where('company_id', $journal->company_id)->where('kind', 'regular')
            ->where('starts_on', '<=', $journal->journal_date->format('Y-m-d'))
            ->where('ends_on', '>=', $journal->journal_date->format('Y-m-d'))
            ->first();
    }
}
