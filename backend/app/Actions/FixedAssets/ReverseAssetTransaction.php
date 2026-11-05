<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets;

use App\Actions\FixedAssets\Inputs\ReverseAssetDocumentInput;
use App\Actions\Ledger\Inputs\ReverseJournalInput;
use App\Actions\Ledger\ReverseJournal;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\FixedAssets\FixedAsset;
use App\Services\FixedAssets\AssetActivity;
use App\Services\FixedAssets\AssetLedger;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Reverses a posted disposal, impairment, impairment reversal or revaluation (`fixed_assets.reverse`, signed): its journal is mirrored by ReverseJournal (dated per D3),
 * each asset's movement is taken back out of the register with a reversing movement (a disposed asset is active again), and the document becomes `reversed`. Refused while a later run, impairment, revaluation or disposal still stands on the same assets: undo those
 * first, in reverse order. Correction is by reversal; nothing posted is edited.
 */
final class ReverseAssetTransaction
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly ReverseJournal $journals,
        private readonly AssetLedger $ledger,
        private readonly AssetActivity $activity,
    ) {}

    public function handle(Actor $actor, ReverseAssetDocumentInput $in): AssetTransaction
    {
        if ($actor->isApiClient()) {
            throw DomainRuleViolation::single('forbidden', 'Only a person can reverse a document.');
        }

        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $seen = AssetTransaction::query()->findOrFail($in->documentId);
            $this->assertReversible($seen);
            $journalId = $seen->journal_id;

            $locked = null;
            $reversal = null;
            if ($journalId !== null) {
                $reversal = $this->journals->handle($actor, new ReverseJournalInput(
                    journalId: $journalId, date: $in->date, lockVersion: null, memo: $in->memo, permission: 'fixed_assets.reverse',
                    whileLocked: function (LockSet $set) use ($seen, $in, &$locked): void {
                        $locked = $this->lockAll($set, $seen, $in->lockVersion);
                    },
                ));
            } else {
                $locked = $this->lockAll($locks, $seen, $in->lockVersion);
            }
            assert($locked instanceof AssetTransaction);

            $date = $reversal?->journal_date->format('Y-m-d') ?? $locked->tx_date->format('Y-m-d');
            $this->ledger->reverseDocument('asset_transaction', $locked->id, $date, $reversal?->id);

            $before = $locked->attributesToArray();
            $locked->forceFill(['status' => DocumentStatus::Reversed, 'reversal_journal_id' => $reversal?->id, 'lock_version' => $locked->lock_version + 1])->save();
            $audit->add('asset_transaction.reversed', $locked, before: $before, after: $locked, context: ['reversal_journal_id' => $reversal?->id]);

            return $locked;
        });
    }

    private function lockAll(LockSet $locks, AssetTransaction $seen, ?int $version): AssetTransaction
    {
        $run = $locks->document($seen, $version);                                       // 2 (rank 60)
        $this->assertReversible($run);
        foreach ($run->lines()->get()->pluck('asset_id')->sort()->values() as $assetId) {
            $locks->document(FixedAsset::query()->findOrFail((string) $assetId));                // 2 (rank 70, by id)
        }
        if ($this->activity->hasLaterActivity('asset_transaction', $run->id)) {
            throw DomainRuleViolation::single('reversal_blocked_by_later_activity', 'Later depreciation or another asset transaction stands on the same assets. Reverse those first, newest first.');
        }

        return $run;
    }

    private function assertReversible(AssetTransaction $run): void
    {
        if ($run->status === DocumentStatus::Reversed) {
            throw DomainRuleViolation::single('document_already_reversed', 'The document has already been reversed.');
        }
        if ($run->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('document_not_reversible', 'Only a posted document can be reversed.');
        }
    }
}
