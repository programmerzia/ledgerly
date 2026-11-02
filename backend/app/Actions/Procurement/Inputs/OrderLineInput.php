<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

/** One order line as stated. `id` names a line the order already has. A requisition link is set only by conversion, never by a client. */
final readonly class OrderLineInput
{
    /** @param array<int, string> $dims dimension slot → value id */
    public function __construct(
        public string $quantity,
        public ?string $id = null,
        public ?string $itemId = null,
        public ?string $accountId = null,
        public ?string $description = null,
        public ?int $unitPriceFc = null,
        public ?string $taxCodeId = null,
        public bool $taxCodeGiven = false,
        public array $dims = [],
        public ?string $requisitionLineId = null,
    ) {}

    public function withRequisitionLine(?string $id): self
    {
        return new self($this->quantity, $this->id, $this->itemId, $this->accountId, $this->description, $this->unitPriceFc, $this->taxCodeId, $this->taxCodeGiven, $this->dims, $id);
    }
}
