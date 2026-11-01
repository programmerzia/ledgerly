<?php

declare(strict_types=1);

namespace App\Domain\Fx;

use App\Domain\Trade\RevaluationItem;

/** What a revaluation as of a date would do: the adjusting items, the evidence per item and what blocks it. */
final readonly class RevaluationPlan
{
    /**
     * @param  list<RevaluationItem>  $items  non-zero differences only (zero differences are skipped)
     * @param  list<array<string, mixed>>  $rows  evidence for every revalued balance, zero differences included
     * @param  list<string>  $missingRates  foreign currencies without a closing rate; the run is refused while any
     * @param  list<array<string, mixed>>  $residuals  balances with no foreign amount left but a base residue: reported, never adjusted
     */
    public function __construct(
        public string $asOf,
        public string $baseCurrency,
        public array $items,
        public array $rows,
        public array $missingRates,
        public array $residuals,
    ) {}

    public function total(): int
    {
        return array_sum(array_map(static fn (RevaluationItem $i): int => $i->unrealisedGainLoss, $this->items));
    }

    public function isEmpty(): bool
    {
        return $this->items === [];
    }
}
