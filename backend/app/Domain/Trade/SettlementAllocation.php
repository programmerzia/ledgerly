<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/** Allocation of a settlement to one document; base amount and realised FX are supplied by the caller. */
final readonly class SettlementAllocation
{
    public function __construct(
        public string $id,
        public string $invoiceNumber,
        public int $allocatedAmountFc,
        public int $allocatedAmountBase,
        public int $fxGainLoss,
    ) {}
}
