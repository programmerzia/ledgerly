<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/** Allocation of a settlement to one document; `RealisedFx` supplies the base amount and gain or loss. */
final readonly class SettlementAllocation
{
    public function __construct(
        public string $id,
        public string $invoiceNumber,
        public int $allocatedAmountFc,
        public int $allocatedAmountBase,
        public int $fxGainLoss,
        /** The rate the document was carried at; null when it equals the settlement rate. */
        public ?string $invoiceFxRate = null,
    ) {}
}
