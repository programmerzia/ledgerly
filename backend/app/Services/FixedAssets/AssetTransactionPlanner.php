<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Domain\FixedAssets\AssetEvents;
use App\Domain\FixedAssets\AssetOutcome;
use App\Domain\FixedAssets\AssetState;
use App\Domain\FixedAssets\DepreciationCalculator;
use App\Domain\FixedAssets\Months;
use App\Domain\Ledger\ControlType;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Ledger\Account;

/**
 * Works out what a disposal, impairment, impairment reversal or revaluation does to the assets it names, from the register as it
 * stands now, and refuses what the rules refuse. Used to preview, to draft, and again under locks when the document posts.
 *
 * Every kind needs depreciation up to date to the end of the month before the date (a disposal's own month is not charged, so
 * nothing must have been charged in it either), so the carrying amount the event works from is the real one.
 */
final class AssetTransactionPlanner
{
    /**
     * @param  array<string, int>  $inputs  asset id → impairment or reversal amount, or the revalued amount; for a disposal the single asset id → 0
     * @param  array<string, mixed>  $params  disposal: proceeds, proceeds_account_id, transfer_reserve
     * @return list<array{asset: FixedAsset, category: AssetCategory, input: int, outcome: AssetOutcome}>
     */
    public function plan(string $companyId, string $kind, string $txDate, ?string $categoryId, array $inputs, array $params): array
    {
        if ($inputs === []) {
            throw DomainRuleViolation::single('asset_required', 'Choose the asset.');
        }
        $assets = FixedAsset::query()->where('company_id', $companyId)->whereIn('id', array_keys($inputs))->orderBy('number')->get();
        if ($assets->count() !== count($inputs)) {
            throw DomainRuleViolation::single('not_found', 'An asset does not exist.');
        }
        $categories = AssetCategory::query()->where('company_id', $companyId)->get()->keyBy('id');

        if ($kind === 'revaluation') {
            $category = $categories->get((string) $categoryId) ?? throw DomainRuleViolation::single('not_found', 'The category does not exist.');
            if (! $category->isRevalued()) {
                throw DomainRuleViolation::single('category_not_revalued', 'This category is carried at cost. Change its measurement model to revaluation first.');
            }
            $all = FixedAsset::query()->where('company_id', $companyId)->where('category_id', $category->id)->where('status', 'active')->orderBy('number')->get();
            $missing = $all->filter(fn (FixedAsset $a): bool => ! array_key_exists($a->id, $inputs))->pluck('number')->all();
            if ($missing !== [] || $assets->contains(fn (FixedAsset $a): bool => $a->category_id !== $category->id)) {
                throw DomainRuleViolation::single('revaluation_incomplete', 'A revaluation covers the whole category (IAS 16.36): enter a value for every asset in it'.($missing === [] ? '.' : ', missing: '.implode(', ', $missing).'.'));
            }
        }

        $out = [];
        foreach ($assets as $asset) {
            $category = $categories->get($asset->category_id) ?? throw DomainRuleViolation::single('not_found', 'The category does not exist.');
            if ($txDate < $asset->acquired_on->format('Y-m-d')) {
                throw DomainRuleViolation::single('asset_date_invalid', "{$asset->number} was acquired on {$asset->acquired_on->format('Y-m-d')}, after the date given.");
            }
            $state = $asset->state($category);
            if ($state->disposed) {
                throw DomainRuleViolation::single('asset_disposed', "{$asset->number} has been disposed of.");
            }
            $this->assertDepreciationCurrent($asset, $state, $txDate, $kind === 'disposal');
            $input = $inputs[$asset->id];
            $outcome = match ($kind) {
                'disposal' => AssetEvents::disposal($state, (int) ($params['proceeds'] ?? 0), (bool) ($params['transfer_reserve'] ?? false))
                    ->withSet(['status' => 'disposed', 'disposed_on' => $txDate]),
                'impairment' => AssetEvents::impairment($state, $input),
                'impairment_reversal' => AssetEvents::impairmentReversal($state, $input),
                'revaluation' => AssetEvents::revaluation($state, $input),
                default => throw DomainRuleViolation::single('asset_transaction_kind_invalid', 'Unknown kind.'),
            };
            if ($outcome === null) {
                continue;   // revaluation: value unchanged
            }
            $out[] = ['asset' => $asset, 'category' => $category, 'input' => $input, 'outcome' => $outcome];
        }
        if ($out === []) {
            throw DomainRuleViolation::single('revaluation_no_change', 'Every value entered equals the carrying amount, so there is nothing to post.');
        }
        if ($kind === 'disposal') {
            $this->assertProceedsAccount($companyId, (int) ($params['proceeds'] ?? 0), isset($params['proceeds_account_id']) ? (string) $params['proceeds_account_id'] : null);
        }

        return $out;
    }

    private function assertDepreciationCurrent(FixedAsset $asset, AssetState $state, string $txDate, bool $disposal): void
    {
        $priorMonthEnd = Months::endOfPrevious($txDate);
        if (DepreciationCalculator::monthsDue($state, $priorMonthEnd) !== []) {
            throw DomainRuleViolation::single(
                'depreciation_not_current',
                "Run depreciation up to {$priorMonthEnd} for {$asset->number} before this: its carrying amount is out of date.",
            );
        }
        if ($disposal && $state->depreciatedThrough !== null && Months::index($state->depreciatedThrough) >= Months::index($txDate)) {
            throw DomainRuleViolation::single(
                'depreciation_in_disposal_month',
                "{$asset->number} has been depreciated through {$state->depreciatedThrough}. No charge is made in the month of disposal: reverse the depreciation run for that month first.",
            );
        }
    }

    private function assertProceedsAccount(string $companyId, int $proceeds, ?string $accountId): void
    {
        if ($proceeds <= 0) {
            return;
        }
        if ($accountId === null) {
            throw DomainRuleViolation::single('proceeds_account_required', 'Choose the bank, cash or receivable account the proceeds go to.');
        }
        $account = Account::query()->where('company_id', $companyId)->find($accountId)
            ?? throw DomainRuleViolation::single('not_found', 'The proceeds account does not exist.');
        if ($account->account_type !== 'asset' || in_array($account->control_type, [ControlType::Ar, ControlType::Ap], true) || ! $account->is_postable || ! $account->is_active) {
            throw DomainRuleViolation::single('proceeds_account_invalid', "{$account->code} cannot take disposal proceeds: use a bank, cash or other receivable asset account (not trade receivables).");
        }
    }
}
