<?php

declare(strict_types=1);

namespace App\Actions\FixedAssets;

use App\Actions\FixedAssets\Inputs\AssetCategoryInput;
use App\Actions\Ledger\SetupGuard;
use App\Contracts\IdGenerator;
use App\Domain\Ledger\ControlType;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Ledger\Account;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * Asset categories (`fixed_assets.manage`): the accounts a class of assets posts to, its default method and life, and
 * whether it is carried at cost or at a revalued amount. Once a category has assets, its accounts are frozen (the register
 * has to keep tying to those ledger accounts), and it cannot go back to cost while an asset still holds a revaluation reserve.
 */
final class ManageAssetCategory
{
    public function __construct(private readonly UnitOfWork $uow, private readonly IdGenerator $ids, private readonly SetupGuard $guard) {}

    public function create(Actor $actor, AssetCategoryInput $in): AssetCategory
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'fixed_assets.manage', $in->companyId);
            $this->assertShape($in);

            $category = new AssetCategory;
            try {
                $category->forceFill(['id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $in->companyId, ...$this->columns($in)])->save();
            } catch (UniqueConstraintViolationException) {
                throw DomainRuleViolation::single('asset_category_name_taken', 'A category with this name already exists.');
            }
            $category->refresh();
            $audit->add('asset_category.created', $category, after: $category);

            return $category;
        });
    }

    public function update(Actor $actor, string $categoryId, AssetCategoryInput $in): AssetCategory
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $categoryId, $in) {
            $category = $locks->document(AssetCategory::query()->findOrFail($categoryId), $in->version);
            $this->guard->require($actor, 'fixed_assets.manage', $category->company_id);
            $this->assertShape($in);

            $accountsChanged = $category->asset_account_id !== $in->assetAccountId || $category->accumulated_account_id !== $in->accumulatedAccountId
                || $category->expense_account_id !== $in->expenseAccountId || $category->is_depreciable !== $in->isDepreciable;
            $assets = FixedAsset::query()->where('category_id', $category->id);
            if ($accountsChanged && $assets->clone()->exists()) {
                throw DomainRuleViolation::single('asset_category_in_use', 'This category has assets, so its accounts and whether it depreciates can no longer change.');
            }
            if ($in->measurementModel === 'cost' && $category->measurement_model === 'revaluation'
                && $assets->clone()->where(fn ($q) => $q->where('revaluation_reserve', '>', 0)->orWhere('revaluation_deficit', '>', 0))->exists()) {
                throw DomainRuleViolation::single('asset_category_has_reserve', 'An asset in this category still holds a revaluation reserve, so it cannot go back to the cost model.');
            }

            $before = $category->attributesToArray();
            try {
                $category->forceFill([...$this->columns($in), 'lock_version' => $category->lock_version + 1])->save();
            } catch (UniqueConstraintViolationException) {
                throw DomainRuleViolation::single('asset_category_name_taken', 'A category with this name already exists.');
            }
            $category->refresh();
            $audit->add('asset_category.updated', $category, before: $before, after: $category);

            return $category;
        });
    }

    /** @return array<string, mixed> */
    private function columns(AssetCategoryInput $in): array
    {
        return [
            'name' => $in->name, 'asset_account_id' => $in->assetAccountId, 'accumulated_account_id' => $in->accumulatedAccountId,
            'expense_account_id' => $in->expenseAccountId, 'measurement_model' => $in->measurementModel,
            'default_method' => $in->defaultMethod, 'default_life_months' => $in->defaultLifeMonths,
            'default_declining_rate_bp' => $in->defaultDecliningRateBp, 'is_depreciable' => $in->isDepreciable, 'is_active' => $in->isActive,
        ];
    }

    private function assertShape(AssetCategoryInput $in): void
    {
        $account = fn (string $id): ?Account => Account::query()->where('company_id', $in->companyId)->find($id);
        $asset = $account($in->assetAccountId);
        $accum = $account($in->accumulatedAccountId);
        $expense = $account($in->expenseAccountId);
        if ($asset === null || $accum === null || $expense === null) {
            throw DomainRuleViolation::single('account_not_found', 'One of the accounts does not exist in this company.');
        }
        if ($asset->control_type !== ControlType::FixedAsset) {
            throw DomainRuleViolation::single('asset_account_wrong_control', "{$asset->code} is not a fixed asset account (control type fixed_asset).");
        }
        if ($accum->control_type !== ControlType::AccumDepr) {
            throw DomainRuleViolation::single('asset_account_wrong_control', "{$accum->code} is not an accumulated depreciation account (control type accum_depr).");
        }
        if ($expense->account_type !== 'expense') {
            throw DomainRuleViolation::single('asset_account_wrong_type', "{$expense->code} is not an expense account.");
        }
        foreach ([$asset, $accum, $expense] as $a) {
            if (! $a->is_postable || ! $a->is_active) {
                throw DomainRuleViolation::single('account_not_postable', "{$a->code} cannot be posted to (inactive or a group).");
            }
        }
    }
}
