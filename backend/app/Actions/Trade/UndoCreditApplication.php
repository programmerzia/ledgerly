<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Events\Trade\CreditApplicationReversed;
use App\Models\Trade\CreditApplication;
use App\Models\Trade\Invoice;
use App\Models\Trade\Settlement;
use App\Models\Trade\WhtCertificate;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Undoes a credit application: its journal is reversed, the document and the credit get their open amounts back and
 * the application is stamped reversed (never deleted). Same locks as applying it. A person with a signing grant only.
 */
final class UndoCreditApplication
{
    public function __construct(private readonly UnitOfWork $uow, private readonly ReverseJournal $journals, private readonly Clock $clock) {}

    public function handle(Actor $actor, string $applicationId, ?DateTimeImmutable $date = null): CreditApplication
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can undo a credit application.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $applicationId, $date) {
            $app = CreditApplication::query()->findOrFail($applicationId);
            if ($app->reversed_at !== null) {
                throw DomainRuleViolation::single('credit_application_reversed', 'The application has already been undone.');
            }
            $target = Invoice::query()->findOrFail($app->invoice_id);
            $module = $target->kind->isSales() ? 'receipts' : 'payments';

            $source = null;
            $locked = null;
            $reversal = $this->journals->handle($actor, new ReverseJournalInput(
                journalId: $app->journal_id, date: $date, permission: $module.'.reverse',
                whileLocked: function (LockSet $set) use ($app, $target, &$source, &$locked): void {
                    if ($app->settlement_id !== null) {
                        $source = $set->document(Settlement::query()->findOrFail($app->settlement_id));
                        $targetRow = $set->document($target);
                    } else {
                        $pair = [Invoice::query()->findOrFail((string) $app->note_id), $target];
                        usort($pair, fn (Invoice $a, Invoice $b): int => strcmp($a->id, $b->id));
                        $rows = [];
                        foreach ($pair as $row) {
                            $rows[$row->id] = $set->document($row);
                        }
                        $source = $rows[(string) $app->note_id];
                        $targetRow = $rows[$target->id];
                    }
                    $locked = $targetRow;
                    $fresh = CreditApplication::query()->findOrFail($app->id);
                    if ($fresh->reversed_at !== null) {
                        throw DomainRuleViolation::single('credit_application_reversed', 'The application has already been undone.');
                    }
                },
            ));
            assert($locked instanceof Invoice);

            $locked->forceFill(['settled_fc' => $locked->settled_fc - $app->amount_fc, 'settled' => $locked->settled - $app->amount, 'lock_version' => $locked->lock_version + 1])->save();
            if ($source instanceof Settlement) {
                $source->forceFill(['unallocated_fc' => $source->unallocated_fc + $app->amount_fc, 'unallocated' => $source->unallocated + $app->source_amount, 'lock_version' => $source->lock_version + 1])->save();
            } elseif ($source instanceof Invoice) {
                $source->forceFill(['settled_fc' => $source->settled_fc - $app->amount_fc, 'settled' => $source->settled - $app->source_amount, 'lock_version' => $source->lock_version + 1])->save();
            }

            WhtCertificate::query()->where('credit_application_id', $app->id)->where('status', 'issued')->update(['status' => 'void']);

            $before = $app->attributesToArray();
            $app->forceFill(['reversed_at' => $this->clock->now(), 'reversal_journal_id' => $reversal->id])->save();
            $audit->add('credit_application.reversed', $app, before: $before, after: $app, context: ['reversal_journal_id' => $reversal->id]);
            $outbox->add(new CreditApplicationReversed($app->id, $app->company_id, 0, ['reversal_journal_id' => $reversal->id]));

            return $app;
        });
    }
}
