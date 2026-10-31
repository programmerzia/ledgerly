<?php

declare(strict_types=1);

namespace App\Actions\Ledger\Inputs;

use DateTimeImmutable;

final readonly class ReverseJournalInput
{
    public function __construct(
        public string $journalId,
        /** Null = default per D3. */
        public ?DateTimeImmutable $date = null,
        public ?int $lockVersion = null,
        public ?string $memo = null,
    ) {}
}
