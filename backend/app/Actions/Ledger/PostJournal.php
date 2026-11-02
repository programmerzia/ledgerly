<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Actions\Ledger\Inputs\PostJournalInput;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Events\Ledger\JournalPosted;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Services\Banking\BankLedgerHooks;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Posts an existing draft journal (13 §8 template). Called by SubmitDocument / ApproveDocument
 * once workflow and signing rules are satisfied; it does not check those itself.
 */
final class PostJournal
{
    public function __construct(private readonly UnitOfWork $uow, private readonly PostingEngine $engine, private readonly BankLedgerHooks $banking) {}

    public function handle(Actor $actor, PostJournalInput $in): Journal
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $draft = Journal::query()->findOrFail($in->journalId);                         // unlocked read: learn the date
            $period = $this->engine->lockPeriod($locks, $draft->company_id, $draft->journal_type, $draft->journal_date, $draft->fiscal_period_id); // 1
            $doc = $locks->document($draft, $in->lockVersion);                                // 2

            if ($doc->journal_date->format('Y-m-d') !== $draft->journal_date->format('Y-m-d') || $doc->fiscal_period_id !== $draft->fiscal_period_id) {
                throw new RetryUnitOfWork('Journal date changed while locking.');
            }
            if (! in_array($doc->status, [JournalStatus::Draft, JournalStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('journal_not_postable', "A {$doc->status->value} journal cannot be posted.");
            }

            $this->banking->beforePost($actor, $locks, $doc);                                   // 2: bank account, statement line (bank transactions)

            $company = Company::query()->findOrFail($doc->company_id);
            $journalDraft = $this->engine->draftOf($doc->load('lines'), $company->base_currency);
            $ctx = $this->engine->context($actor, $journalDraft, $period);
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the journal date.')]);
            }
            $plan = $this->engine->decide($journalDraft, $ctx, $period);

            [$key, $prefix] = $this->engine->sequenceFor($period);
            $number = $locks->sequence($doc->company_id, $key, $prefix);                     // 3

            $before = $doc->attributesToArray();
            $posted = $this->engine->markPosted($doc, $plan, $number, $period, $actor);
            $locks->balances($doc->company_id, $period->id, $plan->balanceDeltas);           // 4

            $audit->add('journal.posted', $posted, before: $before, after: $posted);
            $outbox->add(new JournalPosted($posted->id, $posted->company_id, $number, $posted->lock_version));

            return $posted;
        });
    }
}
