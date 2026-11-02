<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

/** One bill line set against its order line for the three-way match. Prices are minor units of one currency. */
final readonly class MatchLine
{
    public function __construct(
        public int $lineNo,
        public string $orderLineId,
        public string $orderLabel,
        public string $quantity,
        public int $unitPriceFc,
        public string $discountPct,
        public int $orderPriceFc,
        public string $received,
        /** On other pending and posted bills, not this one. */
        public string $billedElsewhere,
    ) {}
}
