<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets;

use App\Actions\FixedAssets\Inputs\DepreciationRunInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentStatus;
use App\Models\FixedAssets\DepreciationRun;
use App\Models\FixedAssets\DepreciationRunLine;
use App\Services\FixedAssets\DepreciationPlanner;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Drafts the depreciation run of a period (`fixed_assets.run_depreciation`): the figures the preview showed, stored per asset.
 * Nothing posts here. Approving posts them (PostDepreciationRun), after checking that no asset changed since. A period has one
 * run unless the earlier one is voided or reversed (also a unique index), and a run cannot be drafted into a closed period.
 */
final class CreateDepreciationRun
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly DepreciationPlanner $planner,
    ) {}

    public function handle(Actor $actor, DepreciationRunInput $in): DepreciationRun
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'fixed_assets.run_depreciation', $in->companyId);
            $period = $locks->periodsById($in->companyId, [$in->periodId])[0] ?? throw DomainRuleViolation::single('not_found', 'The period does not exist.');
            if ($period->kind !== 'regular') {
                throw DomainRuleViolation::single('depreciation_period_invalid', 'Depreciation runs on a regular period, not the adjustment period.');
            }
            if (! in_array($period->status, [PeriodStatus::Open, PeriodStatus::SoftClosed], true)) {
                throw DomainRuleViolation::single('period_closed', "The period is {$period->status->value}; reopen it before depreciating.");
            }
            $active = DepreciationRun::query()->where('company_id', $in->companyId)->whereNotIn('status', ['void', 'reversed']);
            if ($active->clone()->where('fiscal_period_id', $period->id)->exists()) {
                throw DomainRuleViolation::single('depreciation_run_exists', 'This period already has a depreciation run. Void or reverse it first.');
            }
            if ($active->clone()->where('as_of', '<', $period->ends_on->format('Y-m-d'))->whereIn('status', ['draft', 'pending_approval'])->exists()) {
                throw DomainRuleViolation::single('earlier_run_pending', 'An earlier period\'s depreciation run is still waiting to be posted. Post or void it first.');
            }

            $plan = $this->planner->plan($in->companyId, $period->ends_on->format('Y-m-d'), $in->units);
            if ($plan->pendingUnits !== []) {
                $names = implode(', ', array_map(static fn ($a): string => $a->number, $plan->pendingUnits));

                throw DomainRuleViolation::single('units_required', "Enter the units used this period for: {$names}.");
            }
            if ($plan->isEmpty()) {
                throw DomainRuleViolation::single('nothing_to_depreciate', 'No asset has depreciation due up to the end of this period.');
            }

            $run = new DepreciationRun;
            $run->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'status' => DocumentStatus::Draft,
                'fiscal_period_id' => $period->id, 'as_of' => $period->ends_on, 'total' => $plan->total, 'memo' => $in->memo,
                'created_by' => $actor->id, 'lock_version' => 0,
            ]);
            try {
                $run->save();
            } catch (UniqueConstraintViolationException) {
                throw DomainRuleViolation::single('depreciation_run_exists', 'This period already has a depreciation run. Void or reverse it first.');
            }
            $no = 0;
            foreach ($plan->lines as $line) {
                $charge = $line['charge'];
                (new DepreciationRunLine)->forceFill([
                    'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'depreciation_run_id' => $run->id,
                    'line_no' => ++$no, 'asset_id' => $line['asset']->id, 'amount' => $charge->amount, 'months' => count($charge->months),
                    'units' => $charge->units, 'detail' => ['schedule' => $charge->schedule, 'catch_up_months' => $charge->catchUpMonths($period->ends_on->format('Y-m-d'))],
                ])->save();
            }
            $run->refresh()->load('lines');
            $audit->add('depreciation_run.created', $run, after: $run, context: ['assets' => $no, 'total' => $plan->total]);

            return $run;
        });
    }
}
