<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets;

use App\Actions\FixedAssets\Inputs\FixedAssetInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\FixedAssets\Estimates;
use App\Domain\FixedAssets\Months;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Ledger\Dimension;
use App\Models\Ledger\DimensionValue;
use App\Services\FixedAssets\AssetLedger;
use App\Services\FixedAssets\CapitalisationSource;
use App\Services\FixedAssets\MovementSpec;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Puts an asset in the register (`fixed_assets.manage`). It never posts: either the cost is already in the ledger
 * (capitalised from a posted bill line or journal line on a fixed asset account, linked to that line, once) or the
 * asset is an opening asset whose cost and accumulated depreciation come in with the opening balances import. A register entry with
 * neither would carry cost the ledger does not have, so it is refused.
 */
final class CreateFixedAsset
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly IdGenerator $ids,
        private readonly SetupGuard $guard,
        private readonly AssetLedger $ledger,
        private readonly CapitalisationSource $sources,
    ) {}

    public function handle(Actor $actor, FixedAssetInput $in): FixedAsset
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'fixed_assets.manage', $in->companyId);
            $category = AssetCategory::query()->where('company_id', $in->companyId)->find($in->categoryId)
                ?? throw DomainRuleViolation::single('not_found', 'The category does not exist.');
            if (! $category->is_active) {
                throw DomainRuleViolation::single('asset_category_inactive', 'That category is inactive.');
            }

            $opening = $in->sourceType === null;
            $dims = $this->dimensions($in);
            if ($opening) {
                if ($in->cost === null || $in->acquiredOn === null || $in->openingAsOf === null) {
                    throw DomainRuleViolation::single('asset_source_required', 'Capitalise from a posted bill line or journal line, or enter an opening asset with its cost, acquisition date and the date its accumulated depreciation is stated at.');
                }
                $cost = $in->cost;
                $acquired = $in->acquiredOn;
                $journalId = null;
                $ledgerDate = $in->openingAsOf;
            } else {
                $source = $this->sources->resolve($in->companyId, (string) $in->sourceType, (string) $in->sourceId);
                if ($source['account_id'] !== $category->asset_account_id) {
                    throw DomainRuleViolation::single('asset_source_account_mismatch', 'The line is on a different account from the category\'s asset account, so the register would not tie to the ledger.');
                }
                $cost = $in->cost ?? $source['amount'];
                $acquired = $in->acquiredOn ?? $source['date'];
                $journalId = $source['journal_id'];
                $ledgerDate = $source['date'];
                $dims = $dims + array_filter($source['dims'], static fn (?string $v): bool => $v !== null);
            }
            $available = $in->availableFrom ?? $acquired;
            if ($cost <= 0) {
                throw DomainRuleViolation::single('asset_cost_invalid', 'The cost must be more than zero.');
            }
            if ($in->residual < 0 || $in->residual > $cost) {
                throw DomainRuleViolation::single('asset_residual_invalid', 'The residual value must be between zero and the cost.');
            }
            if ($available < $acquired) {
                throw DomainRuleViolation::single('asset_dates_invalid', 'The asset cannot be available for use before it was acquired.');
            }

            $method = $in->method ?? $category->default_method;
            $life = $in->lifeMonths ?? $category->default_life_months;
            $rate = $in->decliningRateBp ?? $category->default_declining_rate_bp;
            Estimates::assert($category->is_depreciable, $method, $life, $rate, $in->unitsTotal);

            [$accumulated, $through, $months] = $opening ? $this->openingFigures($in, $cost, $available, $life) : [0, null, 0];

            $number = $locks->sequence($in->companyId, 'doc:fixed_asset:all', 'FA-');
            $asset = new FixedAsset;
            $asset->forceFill([
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, 'number' => $number,
                'name' => $in->name, 'description' => $in->description, 'category_id' => $category->id, 'status' => 'active',
                'acquired_on' => $acquired, 'available_from' => $available, 'acquisition_cost' => $cost, 'cost' => $cost, 'residual' => $in->residual,
                'accumulated_depreciation' => $accumulated, 'method' => $method, 'useful_life_months' => $life,
                'declining_rate_bp' => $method === 'declining_balance' ? $rate : null,
                'units_total' => $method === 'units_of_production' ? $in->unitsTotal : null,
                'months_charged' => $months, 'depreciated_through' => $through,
                'is_opening' => $opening, 'opening_accumulated' => $accumulated, 'opening_as_of' => $opening ? $in->openingAsOf : null,
                'source_type' => $in->sourceType, 'source_id' => $in->sourceId, 'source_journal_id' => $journalId, 'tax_class_id' => $in->taxClassId,
                'created_by' => $actor->id, 'lock_version' => 0,
                ...$this->dimensionColumns($dims),
            ]);
            try {
                $asset->save();
            } catch (UniqueConstraintViolationException) {
                throw DomainRuleViolation::single('asset_already_capitalised', 'That line is already capitalised as an asset.');
            }
            $this->ledger->log($asset, new MovementSpec(
                (string) $ledgerDate, $opening ? 'opening' : 'addition',
                cost: $cost, depreciation: $accumulated, months: $months, journalId: $journalId,
                set: [], meta: ['source_type' => $in->sourceType, 'source_id' => $in->sourceId],
            ));
            $locks->reportsChanged($in->companyId);
            $asset->refresh();
            $audit->add('fixed_asset.created', $asset, after: $asset, context: ['mode' => $opening ? 'opening' : 'capitalised']);

            return $asset;
        });
    }

    /**
     * Opening asset: accumulated depreciation as stated at the go-live date covers the months from the month available
     * for use to the last full month ended by that date.
     *
     * @return array{0: int, 1: string|null, 2: int}
     */
    private function openingFigures(FixedAssetInput $in, int $cost, string $available, ?int $life): array
    {
        $asOf = (string) $in->openingAsOf;
        $accumulated = $in->openingAccumulated;
        if ($accumulated < 0 || $accumulated > $cost - $in->residual) {
            throw DomainRuleViolation::single('asset_opening_accumulated_invalid', 'Accumulated depreciation cannot be negative or more than the cost less the residual value.');
        }
        $through = Months::isMonthEnd($asOf) ? $asOf : Months::endOfPrevious($asOf);
        $months = Months::index($through) - Months::index($available) + 1;
        if ($months <= 0) {
            if ($accumulated > 0) {
                throw DomainRuleViolation::single('asset_opening_dates_inconsistent', 'Accumulated depreciation is stated, but the asset was not available for use before that date.');
            }

            return [0, null, 0];
        }
        if ($life !== null && $months > $life) {
            $months = $life;
        }

        return [$accumulated, $through, $months];
    }

    /**
     * @param  array<int, string>  $dims
     * @return array<string, string|null>
     */
    private function dimensionColumns(array $dims): array
    {
        $out = [];
        for ($p = 1; $p <= 8; $p++) {
            $out["dim{$p}_value_id"] = $dims[$p] ?? null;
        }

        return $out;
    }

    /**
     * Dimension id → value id from the request, as positions; each value must belong to that dimension and company.
     *
     * @return array<int, string>
     */
    private function dimensions(FixedAssetInput $in): array
    {
        $out = [];
        foreach ($in->dimensions as $dimensionId => $valueId) {
            $dimension = Dimension::query()->where('company_id', $in->companyId)->find($dimensionId);
            $value = DimensionValue::query()->where('company_id', $in->companyId)->where('dimension_id', $dimensionId)->find($valueId);
            if ($dimension === null || $value === null || ! $value->is_active) {
                throw DomainRuleViolation::single('dimension_value_invalid', 'A dimension value does not exist, is inactive, or belongs to another dimension.');
            }
            $out[$dimension->position] = $value->id;
        }

        return $out;
    }
}
