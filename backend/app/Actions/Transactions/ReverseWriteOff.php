<?php

declare(strict_types=1);

namespace App\Actions\Transactions;

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Transactions\TransactionEvent;
use App\Models\Trade\Invoice;
use App\Models\Transactions\WriteOff;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Reverses a posted write-off: the mirror journal comes from ReverseJournal (D3 dating, closed periods refused), the invoice gets its
 * open amount back and returns to the aging, and the write-off becomes `reversed`, all in one transaction. Refused once part of it
 * has been recovered. People only: `write_offs.reverse` and a signing grant.
 */
final class ReverseWriteOff
{
    public function __construct(private readonly UnitOfWork $uow, private readonly ReverseJournal $journals) {}

    public function handle(Actor $actor, string $writeOffId, ?DateTimeImmutable $date = null, ?int $lockVersion = null, ?string $memo = null): WriteOff
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reverse a write-off.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $writeOffId, $date, $lockVersion, $memo) {
            $seen = WriteOff::query()->findOrFail($writeOffId);
            $this->assertReversible($seen);
            $journalId = $seen->journal_id ?? throw DomainRuleViolation::single('write_off_not_reversible', 'The write-off has no journal.');

            $locked = null;
            $invoice = null;
            $reversal = $this->journals->handle($actor, new ReverseJournalInput(
                journalId: $journalId, date: $date, lockVersion: null, memo: $memo, permission: 'write_offs.reverse',
                whileLocked: function (LockSet $set) use ($seen, $lockVersion, &$locked, &$invoice): void {
                    $locked = $set->document($seen, $lockVersion);
                    $this->assertReversible($locked);
                    $invoice = $set->document(Invoice::query()->whereKey($locked->invoice_id)->firstOrFail());
                },
            ));
            assert($locked instanceof WriteOff && $invoice instanceof Invoice);

            $invoice->forceFill([
                'settled_fc' => $invoice->settled_fc - $locked->amount_fc, 'settled' => $invoice->settled - $locked->amount, 'lock_version' => $invoice->lock_version + 1,
            ])->save();
            $before = $locked->attributesToArray();
            $locked->forceFill(['status' => DocumentStatus::Reversed, 'reversal_journal_id' => $reversal->id, 'lock_version' => $locked->lock_version + 1])->save();
            $audit->add('write_off.reversed', $locked, before: $before, after: $locked, context: ['reversal_journal_id' => $reversal->id]);
            $outbox->add(new TransactionEvent('write_off.reversed', $locked->id, $locked->company_id, $locked->lock_version, ['reversal_journal_id' => $reversal->id]));

            return $locked;
        });
    }

    private function assertReversible(WriteOff $w): void
    {
        if ($w->status === DocumentStatus::Reversed) {
            throw DomainRuleViolation::single('write_off_already_reversed', 'The write-off has already been reversed.');
        }
        if ($w->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('write_off_not_reversible', 'Only a posted write-off can be reversed.');
        }
        if ($w->recovered_fc > 0) {
            throw DomainRuleViolation::single('write_off_recovered', 'Part of this write-off has been recovered; undo the recovery first.');
        }
    }
}
