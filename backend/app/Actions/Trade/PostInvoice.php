<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Actions\Ledger\RecordJournal;
use App\Contracts\Clock;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Trade\TradeDocumentPosted;
use App\Models\Trade\Invoice;
use App\Services\Ledger\PostingEngine;
use App\Services\Trade\TradePosting;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Posts a draft or pending document (13 §8 template, §9): period, then the document, then the sequences (the
 * document's own number first, the journal's second, in key order), then the balances (inside RecordJournal).
 * Called by SubmitDocument / ApproveDocument once workflow and signing rules are satisfied; it does not check
 * those itself.
 *
 * The journal is built from the lines read after the document lock, so an edit that committed before the lock
 * is what gets posted and one that comes after waits for it (and is refused: the document is no longer a draft).
 * The document number is allocated only here, inside the posting transaction, so a refusal anywhere in it
 * (closed period, bad account, unbalanced rounding) rolls the number back: numbers stay gapless.
 */
final class PostInvoice
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly TradePosting $trade,
        private readonly RecordJournal $record,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $invoiceId, ?int $lockVersion = null): Invoice
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $invoiceId, $lockVersion) {
            $seen = Invoice::query()->findOrFail($invoiceId);                                          // unlocked read: learn the date
            $date = DateTimeImmutable::createFromInterface($seen->issue_date);
            $period = $this->engine->lockPeriod($locks, $seen->company_id, $seen->kind->journalType(), $date, null); // 1
            $doc = $locks->document($seen, $lockVersion);                                              // 2

            if ($doc->issue_date->format('Y-m-d') !== $seen->issue_date->format('Y-m-d')) {
                throw new RetryUnitOfWork('Document date changed while locking.');
            }
            if (! in_array($doc->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$doc->status->value} {$doc->kind->label()} cannot be posted.");
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the issue date.')]);
            }
            $this->assertRelatedPosted($doc);

            $doc->load('lines');                                                                       // the lines this posting sums
            $kind = $doc->kind;
            $year = $period->fiscalYear()->firstOrFail()->name;
            $number = $locks->sequence($doc->company_id, $kind->sequenceKey($year), $kind->prefix().'-'.$year.'-'); // 3

            $draft = $this->trade->draft($doc, $number);
            $journal = $this->record->handle($actor, new RecordJournalInput($draft, $period->id));      // 3 (journal number), 4 (balances)

            $before = $doc->attributesToArray();
            $doc->forceFill([
                'status' => DocumentStatus::Posted,
                'number' => $number,
                'journal_id' => $journal->id,
                'posted_at' => $this->clock->now(),
                'posted_by' => $actor->id,
                'lock_version' => $doc->lock_version + 1,
            ])->save();

            $audit->add($kind->documentType().'.posted', $doc, before: $before, after: $doc, context: ['kind' => $kind->value, 'journal_id' => $journal->id, 'number' => $number]);
            $outbox->add(new TradeDocumentPosted($kind->documentType(), $doc->id, $doc->company_id, $kind->value, $number, $journal->id, $doc->lock_version));

            return $doc;
        });
    }

    /** A note's original must still be a posted document when the note posts (read after our own lock, never held). */
    private function assertRelatedPosted(Invoice $doc): void
    {
        if ($doc->related_invoice_id === null) {
            return;
        }
        $related = Invoice::query()->find($doc->related_invoice_id);
        if ($related?->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('related_document_not_posted', 'The document the note refers to is not posted.');
        }
    }
}
