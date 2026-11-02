<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

use DateTimeImmutable;

final readonly class RequisitionLineInput
{
    /** @param array<int, string> $dims dimension slot → value id */
    public function __construct(
        public string $quantity,
        public int $estimatedUnitPrice,
        public ?string $itemId = null,
        public ?string $description = null,
        public ?string $accountId = null,
        public array $dims = [],
        public ?DateTimeImmutable $neededBy = null,
    ) {}
}
