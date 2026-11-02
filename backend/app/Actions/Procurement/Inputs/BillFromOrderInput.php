<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

use DateTimeImmutable;

final readonly class BillFromOrderInput
{
    public function __construct(
        public string $orderId,
        public DateTimeImmutable $issueDate,
        /** Bill what this receipt brought in, as far as it is not billed yet. Null: what the order has received and not billed. */
        public ?string $receiptId = null,
        public ?DateTimeImmutable $dueDate = null,
        public ?string $fxRate = null,
        public ?string $reference = null,
    ) {}
}
