<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

final readonly class ConvertLineInput
{
    public function __construct(
        public string $requisitionLineId,
        /** Default: the requisition's estimate, when the order is in the same currency. */
        public ?int $unitPriceFc = null,
        public ?string $taxCodeId = null,
        public bool $taxCodeGiven = false,
    ) {}
}
