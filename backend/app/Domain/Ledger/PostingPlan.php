<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

/** Output of a successful validation: totals and the balance projection deltas. */
final readonly class PostingPlan
{
    /** @param list<BalanceDelta> $balanceDeltas sorted by (account_id, dim_key) — lock order level 4 */
    public function __construct(
        public int $totalDebit,
        public int $totalCredit,
        public array $balanceDeltas,
    ) {}
}
