<?php

declare(strict_types=1);

namespace App\Services\Trade;

/** A document line as the server priced it. */
final readonly class ComputedLine
{
    /**
     * @param  array<string, int>  $taxDetail  tax code id → this line's share of the tax
     * @param  array<int, string>  $dims  dimension slot → value id
     */
    public function __construct(
        public string $accountId,
        public ?string $itemId,
        public ?string $description,
        public string $quantity,
        public int $unitPriceFc,
        public string $discountPct,
        public ?string $taxCodeId,
        public int $lineTotalFc,
        public int $taxAmountFc,
        public array $taxDetail,
        public array $dims,
    ) {}
}
