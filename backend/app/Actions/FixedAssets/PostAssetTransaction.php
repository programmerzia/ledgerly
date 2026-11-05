<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets;

use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Actions\Ledger\RecordJournal;
use App\Contracts\Clock;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\FixedAssets\FixedAsset;
use App\Services\FixedAssets\AssetJournals;
use App\Services\FixedAssets\AssetLedger;
use App\Services\FixedAssets\AssetTransactionReadiness;
use App\Services\FixedAssets\MovementSpec;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\RetryUnitOfWork;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;

/**
 * Posts an approved disposal, impairment, impairment reversal or revaluation (13 §8 template): the period, then the document, then the
 * assets by id, then the document's number and the journal's. Called by SubmitDocument / ApproveDocument.
 *
 * The figures the approvers signed are the ones that post: they are worked out again from the locked assets and must equal the stored
 * lines (`asset_transaction_stale` otherwise). The register moves in the same transaction as the journal, each asset by one movement.
 */
final class PostAssetTransaction
{
    private const array SEQUENCES = [
        'disposal' => ['asset_disposal', 'DSP'], 'impairment' => ['asset_impairment', 'IMP'],
        'impairment_reversal' => ['asset_impairment_reversal', 'IMR'], 'revaluation' => ['asset_revaluation', 'REV'],
    ];

    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly PostingEngine $engine,
        private readonly RecordJournal $record,
        private readonly AssetTransactionReadiness $readiness,
        private readonly AssetJournals $journals,
        private readonly AssetLedger $ledger,
        private readonly Clock $clock,
    ) {}

    public function handle(Actor $actor, string $transactionId, ?int $lockVersion = null): AssetTransaction
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $transactionId, $lockVersion) {
            $seen = AssetTransaction::query()->findOrFail($transactionId);
            $date = DateTimeImmutable::createFromInterface($seen->tx_date);
            $period = $this->engine->lockPeriod($locks, $seen->company_id, JournalType::Asset, $date, null);           // 1
            $tx = $locks->document($seen, $lockVersion);                                                             // 2 (rank 62)
            if ($tx->tx_date->format('Y-m-d') !== $seen->tx_date->format('Y-m-d')) {
                throw new RetryUnitOfWork('Date changed while locking.');
            }
            if (! in_array($tx->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$tx->status->value} {$tx->kind} cannot be posted.");
            }
            if ($period === null) {
                throw PostingRejected::because([new Violation('period_missing', 'No fiscal period covers the date.')]);
            }
            $lines = $tx->lines()->get();
            $assets = [];
            foreach ($lines->pluck('asset_id')->sort()->values() as $assetId) {
                $assets[(string) $assetId] = $locks->document(FixedAsset::query()->findOrFail((string) $assetId));    // 2 (rank 70, by id)
            }

            $plan = $this->readiness->assertCurrent($tx);

            $year = $period->fiscalYear()->firstOrFail()->name;
            [$key, $prefix] = self::SEQUENCES[$tx->kind];
            $number = $locks->sequence($tx->company_id, "doc:{$key}:{$year}", "{$prefix}-{$year}-");                  // 3

            $journal = $this->record->handle($actor, new RecordJournalInput($this->journals->transaction($tx, $plan, $number), $period->id));   // 3, 4

            $movementKind = $tx->kind;
            foreach ($plan as $p) {
                $o = $p['outcome'];
                $this->ledger->record($assets[$p['asset']->id], new MovementSpec(
                    $tx->tx_date->format('Y-m-d'), $movementKind, cost: $o->cost, depreciation: $o->depreciation, impairment: $o->impairment,
                    reserve: $o->reserve, deficit: $o->deficit, journalId: $journal->id, documentType: 'asset_transaction', documentId: $tx->id,
                    set: $o->set, meta: ['facts' => $o->facts],
                ));
            }

            $before = $tx->attributesToArray();
            $tx->forceFill([
                'status' => DocumentStatus::Posted, 'number' => $number, 'journal_id' => $journal->id, 'posted_at' => $this->clock->now(),
                'posted_by' => $actor->id, 'lock_version' => $tx->lock_version + 1,
            ])->save();
            $audit->add("asset_{$tx->kind}.posted", $tx, before: $before, after: $tx, context: ['number' => $number, 'journal_id' => $journal->id, 'assets' => $lines->count()]);

            return $tx;
        });
    }
}
