<?php

declare(strict_types=1);

namespace App\Domain\Transactions;

use App\Domain\Shared\DomainRuleViolation;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;

/**
 * The simplified expected-loss matrix (IFRS 9 5.5.15, B5.5.35): allowance required = Σ over aging buckets of balance × rate, each
 * bucket rounded once HALF_UP to a minor unit (D1). The journal posts only the difference from the allowance already held: a
 * positive difference raises the allowance (Dr bad-debt expense, Cr allowance), a negative one releases it. Pure.
 */
final class ProvisionMatrix
{
    public const array BUCKETS = ['current', 'days_1_30', 'days_31_60', 'days_61_90', 'days_over_90'];

    public const array LABELS = [
        'current' => 'Not yet due', 'days_1_30' => '1 to 30 days overdue', 'days_31_60' => '31 to 60 days overdue',
        'days_61_90' => '61 to 90 days overdue', 'days_over_90' => 'Over 90 days overdue',
    ];

    /**
     * @param  array<string, int>  $balances  base balance per bucket
     * @param  array<string, string>  $ratesPct  percentage per bucket, a decimal string
     * @return array{rows: list<array{bucket: string, label: string, balance: int, rate_pct: string, amount: int}>, required: int}
     */
    public static function required(array $balances, array $ratesPct): array
    {
        $rows = [];
        $required = 0;
        foreach (self::BUCKETS as $bucket) {
            $balance = $balances[$bucket] ?? 0;
            $rate = $ratesPct[$bucket] ?? '0';
            $amount = BigDecimal::of($balance)->multipliedBy($rate)->dividedBy(100, 8, RoundingMode::HalfUp)->toScale(0, RoundingMode::HalfUp)->toInt();
            $rows[] = ['bucket' => $bucket, 'label' => self::LABELS[$bucket], 'balance' => $balance, 'rate_pct' => $rate, 'amount' => $amount];
            $required += $amount;
        }

        return ['rows' => $rows, 'required' => $required];
    }

    /** @return array{debit: string, credit: string, amount: int} which side the allowance moves; refuses a zero difference */
    public static function movement(int $required, int $existing): array
    {
        $difference = $required - $existing;
        if ($difference === 0) {
            throw DomainRuleViolation::single('provision_no_difference', 'The allowance already equals what the rates require; there is nothing to post.');
        }

        return $difference > 0
            ? ['debit' => 'expense', 'credit' => 'allowance', 'amount' => $difference]
            : ['debit' => 'allowance', 'credit' => 'expense', 'amount' => -$difference];
    }
}
