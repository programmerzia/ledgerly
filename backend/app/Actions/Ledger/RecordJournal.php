<?php

declare(strict_types=1);

namespace App\Actions\Ledger;

use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\Violation;
use App\Events\Ledger\JournalPosted;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Creates and posts a system-built journal in one step. Trade, Banking, Fx and year-end build a
 * JournalDraft and hand it here (13 §3); they never insert journals themselves.
 */
final class RecordJournal
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly IdGenerator $ids,
    ) {}

    public function handle(Actor $actor, RecordJournalInput $in): Journal
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $draft = $in->draft;
            $period = $this->engine->lockPeriod($locks, $draft->companyId, $draft->type, $draft->date, $in->fiscalPeriodId);

            $company = Company::query()->findOrFail($draft->companyId);
            $ctx = $this->engine->context($actor, $draft, $period);
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the journal date.')]);
            }
            $plan = $this->engine->decide($draft, $ctx, $period);

            [$key, $prefix] = $this->engine->sequenceFor($period);
            $number = $locks->sequence($draft->companyId, $key, $prefix);

            $journal = $this->engine->insertDraft($actor, $in->id ?? $this->ids->next(), $draft, $company->base_currency, $period->id);
            $posted = $this->engine->markPosted($journal, $plan, $number, $period, $actor);
            $locks->balances($draft->companyId, $period->id, $plan->balanceDeltas);

            $audit->add('journal.posted', $posted, after: $posted);
            $outbox->add(new JournalPosted($posted->id, $posted->company_id, $number, $posted->lock_version));

            return $posted;
        });
    }
}
