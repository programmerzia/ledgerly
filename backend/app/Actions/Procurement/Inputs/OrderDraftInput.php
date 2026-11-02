<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

use DateTimeImmutable;

final readonly class OrderDraftInput
{
    /** @param list<OrderLineInput> $lines */
    public function __construct(
        public string $companyId,
        public string $contactId,
        public DateTimeImmutable $orderDate,
        public array $lines,
        public ?DateTimeImmutable $expectedDate = null,
        /** Default: the supplier's currency. */
        public ?string $currency = null,
        /** Default: the stored rate on the order date. Ignored for base-currency orders. */
        public ?string $fxRate = null,
        public ?string $reference = null,
        public ?string $memo = null,
        /** Client-generated UUIDv7, accepted if unused (13 §12). */
        public ?string $id = null,
    ) {}
}
