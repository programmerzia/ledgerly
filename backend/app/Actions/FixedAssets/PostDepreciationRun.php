<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets;

use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Actions\Ledger\RecordJournal;
use App\Contracts\Clock;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\FixedAssets\FixedAsset;
use App\Services\FixedAssets\AssetJournals;
use App\Services\FixedAssets\AssetLedger;
use App\Services\FixedAssets\DepreciationPlanner;
use App\Services\FixedAssets\DepreciationRunReadiness;
use App\Services\FixedAssets\MovementSpec;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Posts an approved depreciation run (13 §8 template): the period FOR UPDATE for the whole run (so no posting lands between
 * reading the register and posting the result), then the run, then the assets by id, then the run's number and the journal's.
 * Called by SubmitDocument / ApproveDocument once workflow and signing are satisfied.
 *
 * The figures the approvers signed are the ones that post. They are worked out again from the locked assets and must equal the
 * stored lines; an asset changed in between (an estimate, an impairment, a new asset) makes the run `depreciation_run_stale`, and it
 * goes back to be drafted again. One journal: Dr expense, Cr accumulated depreciation per asset.
 */
final class PostDepreciationRun
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly RecordJournal $record,
        private readonly DepreciationPlanner $planner,
        private readonly AssetJournals $journals,
        private readonly AssetLedger $ledger,
        private readonly Clock $clock,
        private readonly DepreciationRunReadiness $readiness,
    ) {}

    public function handle(Actor $actor, string $runId, ?int $lockVersion = null): DepreciationRun
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $runId, $lockVersion) {
            $seen = DepreciationRun::query()->findOrFail($runId);
            $period = $locks->periodsById($seen->company_id, [$seen->fiscal_period_id], forUpdate: true)[0]
                ?? throw DomainRuleViolation::single('not_found', 'The period does not exist.');                       // 1
            $run = $locks->document($seen, $lockVersion);                                                             // 2 (rank 60)
            if (! in_array($run->status, [DocumentStatus::Draft, DocumentStatus::PendingApproval], true)) {
                throw DomainRuleViolation::single('document_not_postable', "A {$run->status->value} depreciation run cannot be posted.");
            }
            if (! in_array($period->status, [PeriodStatus::Open, PeriodStatus::SoftClosed], true)) {
                throw DomainRuleViolation::single('period_closed', "The period is {$period->status->value}; depreciation cannot post into it.");
            }
            $lines = $run->lines()->get();

            $assets = [];
            foreach ($lines->pluck('asset_id')->sort()->values() as $assetId) {
                $assets[(string) $assetId] = $locks->document(FixedAsset::query()->findOrFail((string) $assetId));                       // 2 (rank 70, by id)
            }
            if (DepreciationRun::query()->where('company_id', $run->company_id)->whereIn('status', ['draft', 'pending_approval'])
                ->where('as_of', '<', $run->as_of->format('Y-m-d'))->exists()) {
                throw DomainRuleViolation::single('earlier_run_pending', 'An earlier period\'s depreciation run is still waiting to be posted.');
            }

            if ($this->readiness->isStale($run)) {
                throw DomainRuleViolation::single('depreciation_run_stale', 'The assets changed since this run was drafted, so its figures are out of date. Return it, void it and draft the run again.');
            }

            $categories = AssetCategory::query()->where('company_id', $run->company_id)->get()->keyBy('id');
            $year = $period->fiscalYear()->firstOrFail()->name;
            $number = $locks->sequence($run->company_id, 'doc:depreciation_run:'.$year, 'DEP-'.$year.'-');           // 3

            $items = [];
            foreach ($lines as $line) {
                $asset = $assets[$line->asset_id];
                $items[] = ['asset' => $asset, 'category' => $categories->get($asset->category_id) ?? throw DomainRuleViolation::single('not_found', 'The asset category does not exist.'), 'amount' => $line->amount];
            }
            $journal = $run->total > 0
                ? $this->record->handle($actor, new RecordJournalInput($this->journals->depreciation($run, $items, $number), $period->id))   // 3, 4
                : null;

            // Counterfactual path and months advance exactly as planned.
            $planned = $this->planner->plan($run->company_id, $run->as_of->format('Y-m-d'), $lines->pluck('units', 'asset_id')->all());
            foreach ($planned->lines as $p) {
                $charge = $p['charge'];
                $this->ledger->record($assets[$p['asset']->id], new MovementSpec(
                    $run->as_of->format('Y-m-d'), 'depreciation', depreciation: $charge->amount, months: count($charge->months), units: $charge->units,
                    journalId: $journal?->id, documentType: 'depreciation_run', documentId: $run->id,
                    set: ['depreciated_through' => $charge->through, 'counterfactual_carrying' => $charge->newCounterfactualCarrying],
                    meta: ['schedule' => $charge->schedule],
                ));
            }

            $before = $run->attributesToArray();
            $run->forceFill([
                'status' => DocumentStatus::Posted, 'number' => $number, 'journal_id' => $journal?->id, 'posted_at' => $this->clock->now(),
                'posted_by' => $actor->id, 'lock_version' => $run->lock_version + 1,
            ])->save();
            $audit->add('depreciation_run.posted', $run, before: $before, after: $run, context: ['number' => $number, 'journal_id' => $journal?->id, 'assets' => $lines->count(), 'total' => $run->total]);

            return $run;
        });
    }
}
