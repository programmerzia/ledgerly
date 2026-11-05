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
use App\Models\Transactions\ProvisionRun;
use App\Services\Ledger\JournalSetPoster;
use App\Services\Ledger\PostingEngine;
use App\Services\Transactions\ProvisionService;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Posts an approved provisioning run: only the difference between the allowance required and the one held. Lock order (13 §8): the
 * period, the run, the allowance account (shared with write-offs), the run's number and the journal's, one balance upsert. The numbers
 * are worked out again under the locks; if the ledger moved since the run was prepared the approval is refused (`provision_run_stale`)
 * rather than posting figures nobody approved.
 */
final class PostProvisionRun
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly JournalSetPoster $poster,
        private readonly ProvisionService $service,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $runId, ?int $lockVersion = null): ProvisionRun
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $runId, $lockVersion) {
            $seen = ProvisionRun::query()->findOrFail($runId);
            $asOf = DateTimeImmutable::createFromInterface($seen->as_of);
            $period = $this->engine->lockPeriod($locks, $seen->company_id, JournalType::Manual, $asOf, null);                    // 1
            $run = $locks->document($seen, $lockVersion);                                                                        // 2 (55)
            if ($run->as_of->format('Y-m-d') !== $seen->as_of->format('Y-m-d')) {
                throw new RetryUnitOfWork('As-of date changed while locking.');
            }
            if (! in_array($run->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$run->status->value} provision run cannot be posted.");
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the as-of date.')]);
            }
            $company = Company::query()->findOrFail($run->company_id);
            $now = $this->service->compute($company, $asOf);
            $locks->document(Account::query()->whereKey($now['allowance_id'])->firstOrFail());                                   // 2 (99)
            if ($now['required'] !== $run->required || $now['existing'] !== $run->existing) {
                throw DomainRuleViolation::single('provision_run_stale', 'The receivables or the allowance changed after this run was prepared. Void it and prepare a new one.');
            }

            $year = $period->fiscalYear()->firstOrFail()->name;
            $number = $locks->sequence($run->company_id, 'doc:provision_run:'.$year, 'PRV-'.$year.'-');                           // 3
            $draft = $this->service->draft($run, $company, $number);
            $journal = $this->poster->post($actor, $locks, $audit, $outbox, $period, $company->base_currency, [$draft])[0];     // 3, 4

            $before = $run->attributesToArray();
            $run->forceFill([
                'status' => DocumentStatus::Posted, 'number' => $number, 'journal_id' => $journal->id, 'posted_at' => $this->clock->now(),
                'posted_by' => $actor->id, 'lock_version' => $run->lock_version + 1,
            ])->save();
            $audit->add('provision_run.posted', $run, before: $before, after: $run, context: ['journal_id' => $journal->id, 'difference' => $run->difference]);
            $outbox->add(new TransactionEvent('provision_run.posted', $run->id, $run->company_id, $run->lock_version, ['number' => $number, 'difference' => $run->difference]));

            return $run;
        });
    }
}
