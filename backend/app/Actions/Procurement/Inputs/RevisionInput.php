<?php

declare(strict_types=1);

namespace App\Actions\Procurement\Inputs;

use DateTimeImmutable;

/** What a revision proposes. Supplier, currency, rate and order date are fixed on an approved order. */
final readonly class RevisionInput
{
    /** @param list<OrderLineInput> $lines */
    public function __construct(
        public string $reason,
        public array $lines,
        public ?DateTimeImmutable $expectedDate = null,
        public ?string $reference = null,
        public ?string $memo = null,
    ) {}
}
