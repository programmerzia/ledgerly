<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

use DateTimeImmutable;

final readonly class GoodsReceiptInput
{
    /** @param list<ReceiptLineInput> $lines */
    public function __construct(
        public string $companyId,
        public string $orderId,
        public DateTimeImmutable $receiptDate,
        public array $lines,
        /** The order version the person was looking at; a receipt moves the order on, so a stale one answers 409. */
        public ?int $orderVersion = null,
        public ?string $reference = null,
        public ?string $memo = null,
        public ?string $id = null,
    ) {}
}
