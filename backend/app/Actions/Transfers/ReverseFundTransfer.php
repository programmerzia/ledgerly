<?php

declare(strict_types=1);

namespace App\Actions\Transfers;

use App\Contracts\PermissionChecker;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Transactions\TransactionEvent;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Models\Transfers\FundTransfer;
use App\Services\Banking\BankLedgerHooks;
use App\Services\Ledger\JournalSetPoster;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Reverses a posted transfer: both legs when it is completed, the send leg alone while it is in transit, in one transaction
 * and one date (not before the later leg). Periods first (the original legs' and the reversal's), then the legs' journals
 * by id, then the transfer, then any bank account a leg was matched on; one merged balance upsert. A leg inside a finished
 * reconciliation refuses (`journal_in_finished_reconciliation`). People only: `transfers.reverse` and a signing grant.
 */
final class ReverseFundTransfer
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PermissionChecker $permissions,
        private readonly JournalSetPoster $poster,
        private readonly BankLedgerHooks $banking,
    ) {}

    public function handle(Actor $actor, string $transferId, ?DateTimeImmutable $date = null, ?int $lockVersion = null, ?string $memo = null): FundTransfer
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reverse a transfer.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $transferId, $date, $lockVersion, $memo) {
            $seen = FundTransfer::query()->findOrFail($transferId);
            if (! $this->permissions->allows($actor, 'transfers.reverse', $seen->company_id)) {
                throw DomainRuleViolation::single('forbidden', 'This needs the transfers.reverse permission.');
            }
            if (! $actor->hasSigningGrant) {
                throw DomainRuleViolation::single('signature_required', 'Reversing needs your signing PIN.');
            }
            $this->assertReversible($seen);

            $ids = array_values(array_filter([$seen->send_journal_id, $seen->receive_journal_id]));
            sort($ids, SORT_STRING);
            $originals = Journal::query()->whereIn('id', $ids)->orderBy('journal_date')->get();
            $latest = DateTimeImmutable::createFromInterface($originals->max('journal_date'));
            $on = $date ?? $latest;
            if ($on->format('Y-m-d') < $latest->format('Y-m-d')) {
                throw DomainRuleViolation::single('reversal_before_original', 'The reversal cannot be dated before the transfer\'s latest leg.');
            }

            $periods = $locks->periodsForPost($seen->company_id, [...array_map(fn (Journal $j): DateTimeImmutable => DateTimeImmutable::createFromInterface($j->journal_date), $originals->all()), $on]); // 1
            $period = PostingEngine::periodContaining($periods, $on);
            $locked = [];
            foreach ($ids as $id) {
                $locked[$id] = $locks->document(Journal::query()->whereKey($id)->firstOrFail());                                                        // 2 (rank 10)
            }
            $t = $locks->document($seen, $lockVersion);                                                                                                // 2 (rank 25)
            if ($t->status !== DocumentStatus::Posted || $t->receive_journal_id !== $seen->receive_journal_id) {
                throw new RetryUnitOfWork('Transfer changed while locking.');
            }
            foreach ($locked as $journal) {
                $this->banking->beforeReverse($locks, $journal);                                                                                       // 2 (rank 40)
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the reversal date.')]);
            }

            $company = Company::query()->findOrFail($t->company_id);
            $reversals = $this->poster->reverse($actor, $locks, $audit, $outbox, $period, $company->base_currency, array_values($locked), $on, $memo);   // 3, 4

            $before = $t->attributesToArray();
            $t->forceFill([
                'status' => DocumentStatus::Reversed,
                'send_reversal_journal_id' => $reversals[(string) $t->send_journal_id]->id,
                'receive_reversal_journal_id' => $t->receive_journal_id === null ? null : $reversals[$t->receive_journal_id]->id,
                'lock_version' => $t->lock_version + 1,
            ])->save();
            $audit->add('fund_transfer.reversed', $t, before: $before, after: $t, context: ['legs' => count($reversals)]);
            $outbox->add(new TransactionEvent('fund_transfer.reversed', $t->id, $t->company_id, $t->lock_version, ['legs' => count($reversals)]));

            return $t;
        });
    }

    private function assertReversible(FundTransfer $t): void
    {
        if ($t->status === DocumentStatus::Reversed) {
            throw DomainRuleViolation::single('transfer_already_reversed', 'The transfer has already been reversed.');
        }
        if ($t->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('transfer_not_reversible', 'Only a posted transfer can be reversed.');
        }
    }
}
