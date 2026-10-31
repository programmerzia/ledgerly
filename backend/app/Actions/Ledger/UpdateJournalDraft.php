<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Actions\Ledger\Inputs\UpdateJournalDraftInput;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Ledger\Journal;
use App\Models\Ledger\JournalLine;
use App\Models\Organisation\Company;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Replaces a draft's header fields and lines, guarded by lock_version (13 §8). */
final class UpdateJournalDraft
{
    public function __construct(private readonly UnitOfWork $uow, private readonly PostingEngine $engine) {}

    public function handle(Actor $actor, UpdateJournalDraftInput $in): Journal
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $journal = $locks->document(Journal::query()->findOrFail($in->journalId), $in->lockVersion);
            if (! $journal->status->isEditable()) {
                throw DomainRuleViolation::single('journal_not_editable', 'Only draft journals can be edited.');
            }
            $before = $journal->attributesToArray();
            $company = Company::query()->findOrFail($journal->company_id);

            JournalLine::query()->where('journal_id', $journal->id)->delete();
            $this->engine->insertLines($actor, $journal, $in->lines, $company->base_currency);

            $journal->forceFill([
                'journal_date' => $in->date,
                'reference' => $in->reference,
                'memo' => $in->memo,
                'fiscal_period_id' => $in->fiscalPeriodId,
                'status' => JournalStatus::Draft,
                'lock_version' => $journal->lock_version + 1,
            ])->save();

            $audit->add('journal.updated', $journal, before: $before, after: $journal, context: ['lines' => count($in->lines)]);

            return $journal;
        });
    }
}
