<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

use App\Domain\Fiscal\PeriodKind;
use App\Domain\Fiscal\PeriodStatus;
use App\Domain\Shared\Violation;

/**
 * Validates a JournalDraft against the ledger rules (13 §9) and collects every violation.
 * Pure: the caller loads the PostingContext (with the period read from its locked row).
 */
final class PostingValidator
{
    /** Largest single amount accepted (minor units); keeps sums far from int64 overflow. */
    public const int MAX_AMOUNT = 999_999_999_999_999;

    public function validate(JournalDraft $draft, PostingContext $ctx): PostingPlan
    {
        $violations = [];

        if (count($draft->lines) < 2) {
            $violations[] = new Violation('journal_empty', 'A journal needs at least two lines.');
        }

        $totalDebit = 0;
        $totalCredit = 0;
        $fcSum = 0;
        $currencies = [];

        foreach ($draft->lines as $i => $line) {
            $lineNo = $i + 1;
            array_push($violations, ...$this->amountRules($line, $lineNo));
            array_push($violations, ...$this->accountRules($draft, $line, $lineNo, $ctx));

            $totalDebit += $line->debit;
            $totalCredit += $line->credit;
            $currency = $line->currency ?? $ctx->baseCurrency;
            $currencies[$currency] = true;
            $fcSum += $line->amountFc ?? ($line->debit - $line->credit);
        }

        if ($totalDebit !== $totalCredit) {
            $violations[] = new Violation('journal_unbalanced', sprintf(
                'Debits (%d) and credits (%d) differ by %d.', $totalDebit, $totalCredit, abs($totalDebit - $totalCredit),
            ));
        }

        // D6: a journal whose lines all share one non-base currency must also balance in that currency.
        if (count($currencies) === 1 && ! isset($currencies[$ctx->baseCurrency]) && $fcSum !== 0) {
            $violations[] = new Violation('journal_unbalanced_fc', sprintf(
                'Foreign-currency amounts do not balance (difference %d).', $fcSum,
            ));
        }

        array_push($violations, ...$this->periodRules($draft, $ctx));

        if ($draft->reversalOfDate !== null && $draft->date->format('Y-m-d') < $draft->reversalOfDate->format('Y-m-d')) {
            $violations[] = new Violation('reversal_before_original', 'A reversal cannot be dated before the original journal.');
        }

        if ($violations !== []) {
            throw PostingRejected::because($violations);
        }

        return new PostingPlan($totalDebit, $totalCredit, $this->balanceDeltas($draft));
    }

    /** @return list<Violation> */
    private function amountRules(DraftLine $line, int $lineNo): array
    {
        if ($line->debit < 0 || $line->credit < 0 || $line->debit > self::MAX_AMOUNT || $line->credit > self::MAX_AMOUNT) {
            return [new Violation('amount_out_of_range', 'Amounts must be between 0 and the maximum allowed.', $lineNo)];
        }
        if ($line->debit > 0 && $line->credit > 0) {
            return [new Violation('line_both_sides', 'A line is either a debit or a credit, not both.', $lineNo)];
        }
        if ($line->debit === 0 && $line->credit === 0) {
            return [new Violation('amount_out_of_range', 'A line amount must not be zero.', $lineNo)];
        }

        return [];
    }

    /** @return list<Violation> */
    private function accountRules(JournalDraft $draft, DraftLine $line, int $lineNo, PostingContext $ctx): array
    {
        $account = $ctx->accounts[$line->accountId] ?? null;
        if ($account === null) {
            return [new Violation('account_other_company', 'The account does not belong to this company.', $lineNo)];
        }

        $v = [];
        if (! $account->isPostable) {
            $v[] = new Violation('account_not_postable', "Account {$account->code} is a header account.", $lineNo);
        }
        if (! $account->isActive) {
            $v[] = new Violation('account_inactive', "Account {$account->code} is inactive.", $lineNo);
        }

        $currency = $line->currency ?? $ctx->baseCurrency;
        $allowed = match ($account->currencyPolicy) {
            CurrencyPolicy::BaseOnly => $currency === $ctx->baseCurrency,
            CurrencyPolicy::Fixed => $currency === $account->fixedCurrency,
            CurrencyPolicy::Any => true,
        };
        if (! $allowed) {
            $v[] = new Violation('currency_not_allowed', "Account {$account->code} does not accept {$currency}.", $lineNo);
        }

        if ($currency !== $ctx->baseCurrency) {
            if ($line->fxRate === null || $line->amountFc === null) {
                $v[] = new Violation('fx_rate_missing', 'A foreign-currency line needs a rate and a foreign amount.', $lineNo);
            } elseif (($line->debit > 0 && $line->amountFc <= 0) || ($line->credit > 0 && $line->amountFc >= 0)) {
                $v[] = new Violation('amount_out_of_range', 'The foreign amount must have the same side as the base amount.', $lineNo);
            }
        }

        if ($draft->type === JournalType::Manual && $account->controlType->blocksManualJournals() && ! $account->allowManualJournals) {
            $v[] = new Violation('control_account_direct', "Account {$account->code} is a control account; post through its documents.", $lineNo);
        }
        if ($account->controlType->requiresContact() && $line->contactId === null) {
            $v[] = new Violation('contact_required', "Account {$account->code} needs a customer or supplier.", $lineNo);
        }

        for ($position = 1; $position <= 8; $position++) {
            $rule = $account->dimensionRules[$position] ?? DimensionRule::Optional;
            $valueId = $line->dim($position);

            if ($valueId === null) {
                if ($rule === DimensionRule::Required) {
                    $v[] = new Violation('dimension_required', "Dimension {$position} is required on account {$account->code}.", $lineNo);
                }

                continue;
            }
            if ($rule === DimensionRule::Forbidden) {
                $v[] = new Violation('dimension_forbidden', "Dimension {$position} is not allowed on account {$account->code}.", $lineNo);

                continue;
            }
            $value = $ctx->dimensionValues[$valueId] ?? null;
            if ($value === null || $value->position !== $position) {
                $v[] = new Violation('dimension_value_invalid', "The value for dimension {$position} does not belong to it.", $lineNo);
            } elseif (! $value->isActive) {
                $v[] = new Violation('dimension_inactive', "The value for dimension {$position} is inactive.", $lineNo);
            }
        }

        return $v;
    }

    /** @return list<Violation> */
    private function periodRules(JournalDraft $draft, PostingContext $ctx): array
    {
        $period = $ctx->period;
        if ($period === null) {
            return [new Violation('period_missing', 'No fiscal period covers the journal date.')];
        }

        $v = [];
        if (! $period->contains($draft->date)) {
            $v[] = new Violation('date_outside_period', 'The journal date is outside the target period.');
        }

        $v = [...$v, ...match ($period->status) {
            PeriodStatus::Open => [],
            PeriodStatus::SoftClosed => $ctx->canPostSoftClosed ? [] : [
                new Violation('period_soft_closed', 'The period is soft-closed; posting needs periods.post_soft_closed.'),
            ],
            PeriodStatus::Closed, PeriodStatus::Locked => [new Violation('period_closed', 'The period is closed.')],
        }];

        $inAdjustment = $period->kind === PeriodKind::Adjustment;
        if ($inAdjustment !== $draft->type->isAdjustmentPeriodType()) {
            $v[] = new Violation('period_adjustment_only', $inAdjustment
                ? 'The adjustment period accepts only closing and adjustment journals.'
                : 'Closing and adjustment journals post only into the adjustment period.');
        } elseif ($inAdjustment && ! $ctx->canPostAdjustment) {
            $v[] = new Violation('period_adjustment_forbidden', 'Posting into the adjustment period needs periods.post_adjustment.');
        }

        return $v;
    }

    /** @return list<BalanceDelta> aggregated per (account, dims), sorted for lock order level 4 */
    private function balanceDeltas(JournalDraft $draft): array
    {
        /** @var array<string, BalanceDelta> $byKey */
        $byKey = [];
        foreach ($draft->lines as $line) {
            $dims = [];
            for ($p = 1; $p <= 8; $p++) {
                $dims[$p] = $line->dim($p);
            }
            $key = $line->accountId.'|'.bin2hex(DimKey::of($dims));
            $prev = $byKey[$key] ?? null;
            $byKey[$key] = new BalanceDelta(
                $line->accountId,
                $dims,
                ($prev->debit ?? 0) + $line->debit,
                ($prev->credit ?? 0) + $line->credit,
            );
        }
        ksort($byKey, SORT_STRING);

        return array_values($byKey);
    }
}
