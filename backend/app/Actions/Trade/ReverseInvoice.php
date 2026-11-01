<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Actions\Trade\Inputs\ReverseInvoiceInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Trade\TradeDocumentReversed;
use App\Models\Trade\Invoice;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Reverses a posted invoice, credit note, bill or debit note (13 §9): its journal is reversed by ReverseJournal
 * (a mirror dated per D3) and the document becomes `reversed`, in one transaction. A document that has been
 * settled, in whole or in part, is refused: undo the settlement first (2.12 unwinds allocations). The check
 * runs on `settled_fc`/`settled` under the document lock, so a settlement racing the reversal cannot slip past.
 * A person only, with the `<type>s.reverse` permission and a signing grant (ADR-0004).
 */
final class ReverseInvoice
{
    public function __construct(private readonly UnitOfWork $uow, private readonly ReverseJournal $journals) {}

    public function handle(Actor $actor, ReverseInvoiceInput $in): Invoice
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reverse a document.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $seen = Invoice::query()->findOrFail($in->invoiceId);
            $this->assertReversible($seen);
            $journalId = $seen->journal_id ?? throw DomainRuleViolation::single('invoice_not_reversible', 'The document has no journal.');

            $locked = null;
            $reversal = $this->journals->handle($actor, new ReverseJournalInput(
                journalId: $journalId,
                date: $in->date,
                lockVersion: null,
                memo: $in->memo,
                permission: $seen->kind->documentType().'s.reverse',
                whileLocked: function (LockSet $set) use ($seen, $in, &$locked): void {
                    // Level 2 after the journal (rank 10 < 20): lock the document and decide on what is true now.
                    $locked = $set->document($seen, $in->lockVersion);
                    $this->assertReversible($locked);
                },
            ));
            assert($locked instanceof Invoice);

            $before = $locked->attributesToArray();
            $locked->forceFill([
                'status' => DocumentStatus::Reversed,
                'reversal_journal_id' => $reversal->id,
                'lock_version' => $locked->lock_version + 1,
            ])->save();

            $type = $locked->kind->documentType();
            $audit->add("{$type}.reversed", $locked, before: $before, after: $locked, context: ['kind' => $locked->kind->value, 'reversal_journal_id' => $reversal->id]);
            $outbox->add(new TradeDocumentReversed($type, $locked->id, $locked->company_id, $reversal->id, $locked->lock_version));

            return $locked;
        });
    }

    private function assertReversible(Invoice $doc): void
    {
        if ($doc->status === DocumentStatus::Reversed) {
            throw DomainRuleViolation::single('invoice_already_reversed', "The {$doc->kind->label()} has already been reversed.");
        }
        if ($doc->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('invoice_not_reversible', "Only a posted {$doc->kind->label()} can be reversed.");
        }
        if ($doc->settled_fc !== 0 || $doc->settled !== 0) {
            throw DomainRuleViolation::single('invoice_has_settlements', "The {$doc->kind->label()} has settlements; undo them before reversing it.");
        }
    }
}
