<?php

declare(strict_types=1);

namespace App\Actions\Trade\Inputs;

use DateTimeImmutable;

final readonly class ReverseSettlementInput
{
    public function __construct(
        public string $settlementId,
        /** Null = default per D3. */
        public ?DateTimeImmutable $date = null,
        public ?int $lockVersion = null,
        public ?string $memo = null,
    ) {}
}
