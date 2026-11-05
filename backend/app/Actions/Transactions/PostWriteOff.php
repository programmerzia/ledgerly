<?php

declare(strict_types=1);

namespace App\Actions\Transactions;

use App\Contracts\Clock;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Transactions\TransactionEvent;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Trade\Invoice;
use App\Models\Transactions\WriteOff;
use App\Services\Ledger\JournalSetPoster;
use App\Services\Ledger\PostingEngine;
use App\Services\Trade\PostingAccountResolver;
use App\Services\Transactions\WriteOffService;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Posts an approved write-off. Lock order (13 §8): period, the write-off, its invoice, the credit-loss allowance account (so two
 * write-offs cannot both spend the same allowance), then the write-off's number and the journal's, one balance upsert. The
 * invoice's `settled` rises by the carried amount, so it leaves the aging and its open amount is gone. Called by SubmitDocument / ApproveDocument.
 */
final class PostWriteOff
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly JournalSetPoster $poster,
        private readonly WriteOffService $service,
        private readonly PostingAccountResolver $accounts,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $writeOffId, ?int $lockVersion = null): WriteOff
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $writeOffId, $lockVersion) {
            $seen = WriteOff::query()->findOrFail($writeOffId);
            $period = $this->engine->lockPeriod($locks, $seen->company_id, JournalType::Sales, DateTimeImmutable::createFromInterface($seen->write_off_date), null); // 1
            $w = $locks->document($seen, $lockVersion);                                                                                                           // 2 (26)
            if ($w->write_off_date->format('Y-m-d') !== $seen->write_off_date->format('Y-m-d')) {
                throw new RetryUnitOfWork('Write-off date changed while locking.');
            }
            if (! in_array($w->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$w->status->value} write-off cannot be posted.");
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the write-off date.')]);
            }
            $invoice = $locks->document(Invoice::query()->findOrFail($w->invoice_id));                                                                             // 2 (30)
            $this->service->assertWritable($invoice, $w->amount_fc, DateTimeImmutable::createFromInterface($w->write_off_date));
            $company = Company::query()->findOrFail($w->company_id);
            $allowanceId = $this->accounts->required($company, 'credit_loss_allowance', 'credit-loss allowance');
            $locks->document(Account::query()->whereKey($allowanceId)->firstOrFail());                                                                             // 2 (99)

            $year = $period->fiscalYear()->firstOrFail()->name;
            $number = $locks->sequence($w->company_id, 'doc:write_off:'.$year, 'WO-'.$year.'-');                                                                   // 3
            $plan = $this->service->plan($w, $invoice, $company, $number);
            $draft = $this->service->toDraft($company->id, $plan['proposed'], $company->base_currency);
            $journal = $this->poster->post($actor, $locks, $audit, $outbox, $period, $company->base_currency, [$draft])[0];                                        // 3, 4

            $invoice->forceFill(['settled_fc' => $invoice->settled_fc + $w->amount_fc, 'settled' => $invoice->settled + $plan['carried'], 'lock_version' => $invoice->lock_version + 1])->save();
            $before = $w->attributesToArray();
            $w->forceFill([
                'status' => DocumentStatus::Posted, 'number' => $number, 'journal_id' => $journal->id, 'amount' => $plan['carried'],
                'allowance_used' => $plan['allowance'], 'expense' => $plan['expense'], 'posted_at' => $this->clock->now(), 'posted_by' => $actor->id,
                'lock_version' => $w->lock_version + 1,
            ])->save();
            $audit->add('write_off.posted', $w, before: $before, after: $w, context: ['journal_id' => $journal->id, 'invoice_id' => $invoice->id]);
            $outbox->add(new TransactionEvent('write_off.posted', $w->id, $w->company_id, $w->lock_version, ['number' => $number, 'invoice_id' => $invoice->id]));

            return $w;
        });
    }
}
