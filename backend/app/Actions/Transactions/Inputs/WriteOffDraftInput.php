<?php

declare(strict_types=1);

namespace App\Actions\Transactions\Inputs;

use DateTimeImmutable;

/** A draft write-off: one posted invoice, the date, the amount in the invoice's currency (up to what is open) and the reason. */
final readonly class WriteOffDraftInput
{
    public function __construct(
        public string $companyId,
        public string $invoiceId,
        public DateTimeImmutable $date,
        public int $amountFc,
        public string $reason,
        public ?string $reference = null,
        public ?string $memo = null,
    ) {}
}
