<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

/** What has happened to an order line: ordered, received on recorded receipts, billed on pending and posted bills. */
final readonly class LineFigures
{
    public function __construct(
        public string $orderLineId,
        public string $orderId,
        public string $ordered,
        public string $received,
        public string $billed,
    ) {}

    public function openToReceive(): string
    {
        return Quantity::remaining($this->ordered, $this->received);
    }

    public function receivedNotBilled(): string
    {
        return Quantity::remaining($this->received, $this->billed);
    }

    public function notBilled(): string
    {
        return Quantity::remaining($this->ordered, $this->billed);
    }

    public function isUsed(): bool
    {
        return ! Quantity::isZero($this->received) || ! Quantity::isZero($this->billed);
    }
}
