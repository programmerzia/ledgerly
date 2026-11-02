<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

use DateTimeImmutable;

final readonly class ConvertRequisitionInput
{
    /** @param non-empty-list<ConvertLineInput> $lines */
    public function __construct(
        public string $requisitionId,
        public string $contactId,
        public DateTimeImmutable $orderDate,
        public array $lines,
        public ?DateTimeImmutable $expectedDate = null,
        public ?string $currency = null,
        public ?string $fxRate = null,
        public ?string $reference = null,
        public ?string $memo = null,
    ) {}
}
