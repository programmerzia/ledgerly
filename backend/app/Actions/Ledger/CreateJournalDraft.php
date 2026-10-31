<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Actions\Ledger\Inputs\JournalDraftInput;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\JournalDraft;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/** Saves a manual journal as a draft. Drafts carry no number and are not validated for posting. */
final class CreateJournalDraft
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, JournalDraftInput $in): Journal
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $company = Company::query()->findOrFail($in->companyId);
            $draft = new JournalDraft($company->id, $in->type, $in->date, $in->lines, $in->reference, $in->memo);

            $journal = $this->engine->insertDraft($actor, $in->id ?? $this->ids->next(), $draft, $company->base_currency, $in->fiscalPeriodId);
            $audit->add('journal.created', $journal, after: $journal, context: ['lines' => count($in->lines)]);

            return $journal;
        });
    }
}
