<?php

declare(strict_types=1);

namespace App\Actions\Transactions;

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Transactions\TransactionEvent;
use App\Models\Transactions\ProvisionRun;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/** Reverses a posted provisioning run (a mirror journal, D3 dating); the period may then have a new run. People only: `provisions.reverse` and a signing grant. */
final class ReverseProvisionRun
{
    public function __construct(private readonly UnitOfWork $uow, private readonly ReverseJournal $journals) {}

    public function handle(Actor $actor, string $runId, ?DateTimeImmutable $date = null, ?int $lockVersion = null, ?string $memo = null): ProvisionRun
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reverse a provision run.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $runId, $date, $lockVersion, $memo) {
            $seen = ProvisionRun::query()->findOrFail($runId);
            $this->assertReversible($seen);
            $locked = null;
            $reversal = $this->journals->handle($actor, new ReverseJournalInput(
                journalId: (string) $seen->journal_id, date: $date, lockVersion: null, memo: $memo, permission: 'provisions.reverse',
                whileLocked: function (LockSet $set) use ($seen, $lockVersion, &$locked): void {
                    $locked = $set->document($seen, $lockVersion);
                    $this->assertReversible($locked);
                },
            ));
            assert($locked instanceof ProvisionRun);

            $before = $locked->attributesToArray();
            $locked->forceFill(['status' => DocumentStatus::Reversed, 'reversal_journal_id' => $reversal->id, 'lock_version' => $locked->lock_version + 1])->save();
            $audit->add('provision_run.reversed', $locked, before: $before, after: $locked, context: ['reversal_journal_id' => $reversal->id]);
            $outbox->add(new TransactionEvent('provision_run.reversed', $locked->id, $locked->company_id, $locked->lock_version, ['reversal_journal_id' => $reversal->id]));

            return $locked;
        });
    }

    private function assertReversible(ProvisionRun $run): void
    {
        if ($run->status === DocumentStatus::Reversed) {
            throw DomainRuleViolation::single('provision_run_already_reversed', 'The run has already been reversed.');
        }
        if ($run->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('provision_run_not_reversible', 'Only a posted run can be reversed.');
        }
    }
}
