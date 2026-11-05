<?php

declare(strict_types=1);

namespace App\Actions\Transfers;

use App\Contracts\Clock;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Transfers\FundTransferPosting;
use App\Domain\Workflow\DocumentStatus;
use App\Events\Transactions\TransactionEvent;
use App\Models\Organisation\Company;
use App\Models\Transfers\FundTransfer;
use App\Services\Ledger\JournalSetPoster;
use App\Services\Ledger\PostingEngine;
use App\Services\Transfers\FundTransferService;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Posts an approved fund transfer: the send leg (Dr funds in transit, Cr source), and in the same transaction the
 * receive leg when the transfer was set to settle the same day. Lock order (13 §8): period, transfer, transfer number,
 * journal numbers, one merged balance upsert. Called by SubmitDocument / ApproveDocument.
 */
final class PostFundTransfer
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly JournalSetPoster $poster,
        private readonly FundTransferService $service,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $transferId, ?int $lockVersion = null): FundTransfer
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $transferId, $lockVersion) {
            $seen = FundTransfer::query()->findOrFail($transferId);
            $date = DateTimeImmutable::createFromInterface($seen->send_date);
            $period = $this->engine->lockPeriod($locks, $seen->company_id, JournalType::Bank, $date, null);        // 1
            $t = $locks->document($seen, $lockVersion);                                                            // 2

            if ($t->send_date->format('Y-m-d') !== $seen->send_date->format('Y-m-d')) {
                throw new RetryUnitOfWork('Transfer date changed while locking.');
            }
            if (! in_array($t->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$t->status->value} transfer cannot be posted.");
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the transfer date.')]);
            }
            $company = Company::query()->findOrFail($t->company_id);
            $year = $period->fiscalYear()->firstOrFail()->name;
            $number = $locks->sequence($t->company_id, 'doc:fund_transfer:'.$year, 'TRF-'.$year.'-');              // 3

            $figures = $this->service->figures(self::numbered($t, $number), $company);
            $day = $t->send_date->format('Y-m-d');
            $drafts = [$this->service->sendDraft($figures, $t->company_id, $company->base_currency)];
            $same = $t->settle_same_day;
            if ($same) {
                $drafts[] = $this->service->receiveDraft($figures, $t->company_id, $company->base_currency, $day);
            }
            $journals = $this->poster->post($actor, $locks, $audit, $outbox, $period, $company->base_currency, $drafts); // 3, 4

            $now = $this->clock->now();
            $extra = [];
            if ($same) {
                $sendBase = FundTransferPosting::sendAmounts($t->from_amount_fc, $t->fee_fc, (string) $t->send_rate)['sendBase'];
                $r = FundTransferPosting::receiveAmounts($t->to_amount_fc, (string) $t->receive_rate, $sendBase);
                $extra = [
                    'leg_state' => 'completed', 'receive_journal_id' => $journals[1]->id, 'received_on' => $day,
                    'receive_base' => $r['receiveBase'], 'fx_difference' => $r['difference'], 'received_by' => $actor->id,
                ];
            }
            $before = $t->attributesToArray();
            $t->forceFill([
                'status' => DocumentStatus::Posted, 'number' => $number, 'leg_state' => 'in_transit', 'send_journal_id' => $journals[0]->id,
                'posted_at' => $now, 'posted_by' => $actor->id, 'lock_version' => $t->lock_version + 1, ...$extra,
            ])->save();
            $audit->add('fund_transfer.posted', $t, before: $before, after: $t, context: ['number' => $number, 'completed' => $same]);
            $outbox->add(new TransactionEvent('fund_transfer.posted', $t->id, $t->company_id, $t->lock_version, ['number' => $number, 'leg_state' => $t->leg_state]));

            return $t;
        });
    }

    private static function numbered(FundTransfer $t, string $number): FundTransfer
    {
        $copy = $t->replicate();
        $copy->forceFill(['id' => $t->id, 'number' => $number]);

        return $copy;
    }
}
