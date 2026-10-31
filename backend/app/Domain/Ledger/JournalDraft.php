<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

use DateTimeImmutable;

/** A journal ready for validation and posting. Built by PostingRules or from user input. */
final readonly class JournalDraft
{
    /** @param list<DraftLine> $lines */
    public function __construct(
        public string $companyId,
        public JournalType $type,
        public DateTimeImmutable $date,
        public array $lines,
        public ?string $reference = null,
        public ?string $memo = null,
        public ?string $sourceType = null,
        public ?string $sourceId = null,
        /** Set for reversals: the original journal date (D3). */
        public ?DateTimeImmutable $reversalOfDate = null,
    ) {}
}
