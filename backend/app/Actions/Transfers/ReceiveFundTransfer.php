<?php

declare(strict_types=1);

namespace App\Actions\Transfers;

use App\Contracts\PermissionChecker;
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
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Books the receive leg of a transfer that is in transit (Dr destination, Cr funds in transit, and the base difference to
 * realised FX). It records a fact (the money arrived, on this date, for this amount), so it needs `transfers.receive` and a
 * signing grant, not a second approval: the transfer itself was approved before the send leg posted.
 */
final class ReceiveFundTransfer
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PermissionChecker $permissions,
        private readonly PostingEngine $engine,
        private readonly JournalSetPoster $poster,
        private readonly FundTransferService $service,
    ) {}

    public function handle(Actor $actor, string $transferId, DateTimeImmutable $receivedOn, ?int $toAmountFc = null, ?string $receiveRate = null, ?int $lockVersion = null): FundTransfer
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can record a receipt.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $transferId, $receivedOn, $toAmountFc, $receiveRate, $lockVersion) {
            $seen = FundTransfer::query()->findOrFail($transferId);
            if (! $this->permissions->allows($actor, 'transfers.receive', $seen->company_id)) {
                throw DomainRuleViolation::single('forbidden', 'This needs the transfers.receive permission.');
            }
            if (! $actor->hasSigningGrant) {
                throw DomainRuleViolation::single('signature_required', 'Recording a receipt needs your signing PIN.');
            }
            $period = $this->engine->lockPeriod($locks, $seen->company_id, JournalType::Bank, $receivedOn, null);   // 1
            $t = $locks->document($seen, $lockVersion);                                                              // 2

            if ($t->status !== DocumentStatus::Posted || $t->leg_state !== 'in_transit') {
                throw DomainRuleViolation::single('transfer_not_in_transit', 'Only a transfer that has been sent and not yet received can be received.');
            }
            if ($receivedOn->format('Y-m-d') < $t->send_date->format('Y-m-d')) {
                throw DomainRuleViolation::single('transfer_received_before_sent', 'The money cannot arrive before it was sent.');
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the receipt date.')]);
            }
            $company = Company::query()->findOrFail($t->company_id);
            $rate = $this->service->rate($company, $t->to_currency, $receivedOn->format('Y-m-d'), $receiveRate);
            $amount = $toAmountFc ?? $t->to_amount_fc;
            $figures = $this->service->figures($t, $company, $amount, $rate);
            $draft = $this->service->receiveDraft($figures, $t->company_id, $company->base_currency, $receivedOn->format('Y-m-d'));
            $journal = $this->poster->post($actor, $locks, $audit, $outbox, $period, $company->base_currency, [$draft])[0];       // 3, 4

            $sendBase = FundTransferPosting::sendAmounts($t->from_amount_fc, $t->fee_fc, (string) $t->send_rate)['sendBase'];
            $r = FundTransferPosting::receiveAmounts($amount, $rate, $sendBase);
            $before = $t->attributesToArray();
            $t->forceFill([
                'leg_state' => 'completed', 'receive_journal_id' => $journal->id, 'received_on' => $receivedOn, 'to_amount_fc' => $amount,
                'receive_rate' => $rate, 'receive_base' => $r['receiveBase'], 'fx_difference' => $r['difference'], 'received_by' => $actor->id,
                'lock_version' => $t->lock_version + 1,
            ])->save();
            $audit->add('fund_transfer.received', $t, before: $before, after: $t, context: ['journal_id' => $journal->id, 'fx_difference' => $r['difference']]);
            $outbox->add(new TransactionEvent('fund_transfer.received', $t->id, $t->company_id, $t->lock_version, ['fx_difference' => $r['difference']]));

            return $t;
        });
    }
}
