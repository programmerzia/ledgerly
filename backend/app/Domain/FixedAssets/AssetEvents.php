<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

use App\Domain\Shared\DomainRuleViolation;

/**
 * Disposal, impairment, impairment reversal and revaluation of one asset (IAS 16, IAS 36), pure and in integer minor units.
 *
 * Choices (flagged for the accountant, D15.1/D15.9):
 *  - Revaluation eliminates accumulated depreciation and impairment against the gross carrying amount (IAS 16.35(b)) and restates
 *    cost to the revalued amount, so cost afterwards is fair value and accumulated is nil.
 *  - An increase first reverses that asset's earlier losses in profit or loss (16.39), the excess goes to the revaluation reserve;
 *    a decrease uses that asset's reserve first, then profit or loss (16.40). Impairment of a revalued asset is a revaluation
 *    decrease (36.60). Losses and gains in profit or loss use the impairment loss and impairment reversal accounts.
 *  - An impairment reversal on a cost-model asset is capped at the carrying amount depreciation alone would have left (36.117).
 */
final class AssetEvents
{
    public static function disposal(AssetState $s, int $proceeds, bool $transferReserve): AssetOutcome
    {
        if ($s->disposed) {
            throw DomainRuleViolation::single('asset_disposed', 'The asset has already been disposed of.');
        }
        if ($proceeds < 0) {
            throw DomainRuleViolation::single('disposal_proceeds_invalid', 'Proceeds cannot be negative.');
        }
        $carrying = $s->carrying();
        $accumulated = $s->accumulatedDepreciation + $s->accumulatedImpairment;
        $result = $proceeds - $carrying;          // gain when positive
        $lines = [];
        if ($accumulated > 0) {
            $lines[] = new LineSpec('accumulated', debit: $accumulated);
        }
        if ($proceeds > 0) {
            $lines[] = new LineSpec('proceeds', debit: $proceeds);
        }
        $lines[] = new LineSpec('asset', credit: $s->cost);
        if ($result > 0) {
            $lines[] = new LineSpec('gain', credit: $result);
        } elseif ($result < 0) {
            $lines[] = new LineSpec('loss', debit: -$result);
        }
        $transfer = $transferReserve ? $s->revaluationReserve : 0;
        if ($transfer > 0) {
            // Straight to retained earnings, never through profit or loss (16.41).
            $lines[] = new LineSpec('reserve', debit: $transfer);
            $lines[] = new LineSpec('retained', credit: $transfer);
        }

        return new AssetOutcome(
            cost: -$s->cost, depreciation: -$s->accumulatedDepreciation, impairment: -$s->accumulatedImpairment, reserve: -$transfer,
            deficit: -$s->revaluationDeficit, set: ['counterfactual_carrying' => null], lines: $lines,
            facts: ['carrying' => $carrying, 'proceeds' => $proceeds, 'gain_or_loss' => $result, 'reserve_transferred' => $transfer],
        );
    }

    public static function impairment(AssetState $s, int $amount): AssetOutcome
    {
        if ($amount <= 0) {
            throw DomainRuleViolation::single('impairment_amount_invalid', 'The impairment must be more than zero.');
        }
        if ($amount > $s->carrying() - $s->residual) {
            throw DomainRuleViolation::single('impairment_below_residual', 'The impairment cannot take the carrying amount below the residual value. If the asset is worth less than that, lower the residual value first.');
        }
        $fromReserve = $s->revalued ? min($amount, $s->revaluationReserve) : 0;
        $toProfit = $amount - $fromReserve;
        $lines = [];
        if ($fromReserve > 0) {
            $lines[] = new LineSpec('reserve', debit: $fromReserve);
        }
        if ($toProfit > 0) {
            $lines[] = new LineSpec('impairment_loss', debit: $toProfit);
        }
        $lines[] = new LineSpec('accumulated', credit: $amount);

        return new AssetOutcome(
            impairment: $amount, reserve: -$fromReserve, deficit: $s->revalued ? $toProfit : 0,
            // Remember the path without the impairment, to cap a later reversal; a revalued asset's decrease is not reversed this way.
            set: ['counterfactual_carrying' => $s->revalued ? null : ($s->counterfactualCarrying ?? $s->carrying())],
            lines: $lines,
            facts: ['carrying_before' => $s->carrying(), 'carrying_after' => $s->carrying() - $amount, 'from_reserve' => $fromReserve, 'to_profit_or_loss' => $toProfit],
        );
    }

    /** The most an impairment reversal can be now. */
    public static function reversalCap(AssetState $s): int
    {
        if ($s->revalued || $s->counterfactualCarrying === null) {
            return 0;
        }

        return max(0, min($s->accumulatedImpairment, $s->counterfactualCarrying - $s->carrying()));
    }

    public static function impairmentReversal(AssetState $s, int $amount): AssetOutcome
    {
        if ($s->revalued) {
            throw DomainRuleViolation::single('reversal_revalued_asset', 'An asset in a revalued category has its value restored by revaluing the category (IAS 36.119), not by an impairment reversal.');
        }
        $cap = self::reversalCap($s);
        if ($amount <= 0) {
            throw DomainRuleViolation::single('impairment_amount_invalid', 'The reversal must be more than zero.');
        }
        if ($amount > $cap) {
            throw DomainRuleViolation::single('reversal_exceeds_cap', 'At most '.$cap.' (minor units) can be reversed: the carrying amount cannot rise above what depreciation alone would have left (IAS 36.117).');
        }
        $restored = $s->carrying() + $amount === $s->counterfactualCarrying;

        return new AssetOutcome(
            impairment: -$amount, set: ['counterfactual_carrying' => $restored ? null : $s->counterfactualCarrying],
            lines: [new LineSpec('accumulated', debit: $amount), new LineSpec('impairment_reversal', credit: $amount)],
            facts: ['carrying_before' => $s->carrying(), 'carrying_after' => $s->carrying() + $amount, 'cap' => $cap],
        );
    }

    /** $value is the revalued carrying amount (fair value now). Zero change gives null: the asset is left out of the journal. */
    public static function revaluation(AssetState $s, int $value): ?AssetOutcome
    {
        if ($value < $s->residual || $value <= 0) {
            throw DomainRuleViolation::single('revalued_below_residual', 'The revalued amount cannot be below the residual value.');
        }
        $carrying = $s->carrying();
        $change = $value - $carrying;
        if ($change === 0) {
            return null;
        }
        $accumulated = $s->accumulatedDepreciation + $s->accumulatedImpairment;
        $costChange = $value - $s->cost;
        $lines = [];
        if ($accumulated > 0) {
            $lines[] = new LineSpec('accumulated', debit: $accumulated);
        }
        if ($costChange > 0) {
            $lines[] = new LineSpec('asset', debit: $costChange);
        } elseif ($costChange < 0) {
            $lines[] = new LineSpec('asset', credit: -$costChange);
        }

        $reserve = 0;
        $deficit = 0;
        if ($change > 0) {
            $toProfit = min($change, $s->revaluationDeficit);
            $reserve = $change - $toProfit;
            $deficit = -$toProfit;
            if ($toProfit > 0) {
                $lines[] = new LineSpec('impairment_reversal', credit: $toProfit);
            }
            if ($reserve > 0) {
                $lines[] = new LineSpec('reserve', credit: $reserve);
            }
        } else {
            $decrease = -$change;
            $fromReserve = min($decrease, $s->revaluationReserve);
            $toProfit = $decrease - $fromReserve;
            $reserve = -$fromReserve;
            $deficit = $toProfit;
            if ($fromReserve > 0) {
                $lines[] = new LineSpec('reserve', debit: $fromReserve);
            }
            if ($toProfit > 0) {
                $lines[] = new LineSpec('impairment_loss', debit: $toProfit);
            }
        }

        return new AssetOutcome(
            cost: $costChange, depreciation: -$s->accumulatedDepreciation, impairment: -$s->accumulatedImpairment, reserve: $reserve, deficit: $deficit,
            set: ['counterfactual_carrying' => null], lines: $lines,
            facts: ['carrying_before' => $carrying, 'carrying_after' => $value, 'change' => $change, 'to_reserve' => max($reserve, 0), 'to_profit_or_loss' => $change > 0 ? -$deficit : $deficit],
        );
    }
}
