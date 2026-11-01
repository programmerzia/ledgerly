<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

final readonly class ItemInput
{
    public function __construct(
        public string $companyId,
        public string $code,
        public string $name,
        public string $kind,
        public string $currency,
        public ?string $description = null,
        public ?string $salesAccountId = null,
        public ?string $purchaseAccountId = null,
        public int $salesPrice = 0,
        public int $purchasePrice = 0,
        public ?string $taxCodeId = null,
    ) {}
}
