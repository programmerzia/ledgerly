<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

use DateTimeImmutable;

final readonly class ReverseInvoiceInput
{
    public function __construct(
        public string $invoiceId,
        /** Null = default per D3. */
        public ?DateTimeImmutable $date = null,
        public ?int $lockVersion = null,
        public ?string $memo = null,
    ) {}
}
