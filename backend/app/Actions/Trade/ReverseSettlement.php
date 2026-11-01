<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Actions\Trade\Inputs\ReverseSettlementInput;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Trade\SettlementReversed;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;
use App\Models\Trade\SettlementAllocation;
use App\Services\Trade\SettlementWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\DatabaseManager;

/**
 * Reverses a posted settlement (13 §9): the mirror journal comes from ReverseJournal, the documents it settled get
 * their open amounts back (`settled`), credit it consumed is restored, its WHT certificates become void and the
 * settlement becomes `reversed`, all in one transaction. Refused while credit it created has been applied or refunded
 * elsewhere: undo that first. A person only, with `<receipts|payments>.reverse` and a signing grant.
 */
final class ReverseSettlement
{
    public function __construct(private readonly UnitOfWork $uow, private readonly ReverseJournal $journals, private readonly DatabaseManager $db) {}

    public function handle(Actor $actor, ReverseSettlementInput $in): Settlement
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reverse a settlement.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $seen = Settlement::query()->with('allocations')->findOrFail($in->settlementId);
            $this->assertReversible($seen);
            $journalId = $seen->journal_id ?? throw DomainRuleViolation::single('settlement_not_reversible', 'The settlement has no journal.');

            $locked = null;
            $invoices = [];
            $sources = [];
            $reversal = $this->journals->handle($actor, new ReverseJournalInput(
                journalId: $journalId, date: $in->date, lockVersion: null, memo: $in->memo,
                permission: SettlementWriter::module($seen->kind).'.reverse',
                whileLocked: function (LockSet $set) use ($seen, $in, &$locked, &$invoices, &$sources): void {
                    // Level 2 after the journal: this settlement and the ones whose credit it consumed (by id), then the invoices (by id).
                    $sourceIds = array_values(array_filter($seen->allocations->pluck('source_settlement_id')->all()));
                    $ids = [$seen->id, ...$sourceIds];
                    sort($ids, SORT_STRING);
                    foreach ($ids as $id) {
                        $row = $set->document($id === $seen->id ? $seen : Settlement::query()->whereKey($id)->firstOrFail(), $id === $seen->id ? $in->lockVersion : null);
                        $id === $seen->id ? $locked = $row : $sources[$id] = $row;
                    }
                    assert($locked instanceof Settlement);
                    $this->assertReversible($locked);
                    $locked->load('allocations');
                    $this->assertCreditNotUsed($locked);

                    $invoiceIds = array_values(array_filter($locked->allocations->pluck('invoice_id')->all()));
                    sort($invoiceIds, SORT_STRING);
                    foreach ($invoiceIds as $id) {
                        $invoices[$id] = $set->document(Invoice::query()->whereKey($id)->firstOrFail());
                    }
                },
            ));
            assert($locked instanceof Settlement);

            /** @var SettlementAllocation $a */
            foreach ($locked->allocations as $a) {
                if ($a->invoice_id !== null) {
                    $inv = $invoices[$a->invoice_id];
                    $inv->forceFill(['settled_fc' => $inv->settled_fc - $a->amount_fc, 'settled' => $inv->settled - $a->amount, 'lock_version' => $inv->lock_version + 1])->save();
                } else {
                    $src = $sources[(string) $a->source_settlement_id];
                    $src->forceFill(['unallocated_fc' => $src->unallocated_fc + $a->amount_fc, 'unallocated' => $src->unallocated + $a->amount, 'lock_version' => $src->lock_version + 1])->save();
                }
            }
            $this->db->connection()->table('wht_certificates')->where('payment_id', $locked->id)->where('status', 'issued')->update(['status' => 'void']);

            $before = $locked->attributesToArray();
            $locked->forceFill(['status' => DocumentStatus::Reversed, 'reversal_journal_id' => $reversal->id, 'lock_version' => $locked->lock_version + 1])->save();
            $audit->add('settlement.reversed', $locked, before: $before, after: $locked, context: ['kind' => $locked->kind, 'reversal_journal_id' => $reversal->id]);
            $outbox->add(new SettlementReversed($locked->id, $locked->company_id, $locked->lock_version, ['kind' => $locked->kind, 'reversal_journal_id' => $reversal->id]));

            return $locked;
        });
    }

    private function assertReversible(Settlement $s): void
    {
        if ($s->status === DocumentStatus::Reversed) {
            throw DomainRuleViolation::single('settlement_already_reversed', 'The settlement has already been reversed.');
        }
        if ($s->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('settlement_not_reversible', 'Only a posted settlement can be reversed.');
        }
    }

    /** Credit on account this settlement created must not have been applied or refunded (D9): undo those first. */
    private function assertCreditNotUsed(Settlement $s): void
    {
        $conn = $this->db->connection();
        $applied = $conn->table('credit_applications')->where('settlement_id', $s->id)->whereNull('reversed_at')->exists();
        $refunded = $conn->table('settlement_allocations as a')->join('settlements as r', 'r.id', '=', 'a.settlement_id')
            ->where('a.source_settlement_id', $s->id)->where('r.status', DocumentStatus::Posted->value)->exists();
        if ($applied || $refunded) {
            throw DomainRuleViolation::single('settlement_credit_applied', 'Credit from this settlement has been applied or refunded; undo that first.');
        }
    }
}
