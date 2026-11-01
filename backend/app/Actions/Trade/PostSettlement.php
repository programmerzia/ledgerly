<?php

declare(strict_types=1);

namespace App\Actions\Trade;

use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\Organisation\Company;
use App\Models\Trade\Settlement;
use App\Services\Ledger\PostingEngine;
use App\Services\Trade\SettlementPoster;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Posts a draft or pending settlement (13 §8): period, then the settlement (and any settlement whose credit it
 * refunds) sorted by id, then the invoices sorted by id, then sequences and balances. Called by SubmitDocument /
 * ApproveDocument once workflow and signing rules are satisfied; it does not check those itself.
 */
final class PostSettlement
{
    public function __construct(private readonly UnitOfWork $uow, private readonly PostingEngine $engine, private readonly SettlementPoster $poster) {}

    public function handle(Actor $actor, string $settlementId, ?int $lockVersion = null): Settlement
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $settlementId, $lockVersion) {
            $seen = Settlement::query()->with('allocations')->findOrFail($settlementId);       // unlocked read: learn date and sources
            $date = DateTimeImmutable::createFromInterface($seen->settlement_date);
            $period = $this->engine->lockPeriod($locks, $seen->company_id, $seen->isCashIn() ? JournalType::Receipt : JournalType::Payment, $date, null); // 1

            $sourceIds = array_values(array_filter($seen->allocations->pluck('source_settlement_id')->all()));
            $ids = [$seen->id, ...$sourceIds];
            sort($ids, SORT_STRING);
            $sources = [];
            $doc = null;
            foreach ($ids as $id) {                                                             // 2: settlements by id
                $row = $id === $seen->id ? $seen : Settlement::query()->whereKey($id)->first();
                if ($row === null) {
                    throw DomainRuleViolation::single('allocation_target_invalid', 'The credit to refund does not exist.');
                }
                $locked = $locks->document($row, $id === $seen->id ? $lockVersion : null);
                $id === $seen->id ? $doc = $locked : $sources[$id] = $locked;
            }
            assert($doc instanceof Settlement);

            if ($doc->settlement_date->format('Y-m-d') !== $seen->settlement_date->format('Y-m-d')) {
                throw new RetryUnitOfWork('Settlement date changed while locking.');
            }
            if (! in_array($doc->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$doc->status->value} settlement cannot be posted.");
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the settlement date.')]);
            }
            $doc->load('allocations');
            $again = array_values(array_filter($doc->allocations->pluck('source_settlement_id')->all()));
            sort($again, SORT_STRING);
            $sorted = $sourceIds;
            sort($sorted, SORT_STRING);
            if ($again !== $sorted) {
                throw new RetryUnitOfWork('Allocations changed while locking.');
            }

            $company = Company::query()->findOrFail($doc->company_id);
            $invoices = $this->poster->lockInvoices($locks, [$doc]);                            // 2: invoices by id
            [$posted] = $this->poster->post($actor, $locks, $audit, $outbox, [$doc], $period, $company, $invoices, $sources);

            return $posted;
        });
    }
}
