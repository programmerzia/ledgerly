<?php

declare(strict_types=1);

namespace App\Actions\Ledger\Inputs;

use App\Domain\Ledger\DraftLine;
use DateTimeImmutable;

final readonly class UpdateJournalDraftInput
{
    /** @param list<DraftLine> $lines */
    public function __construct(
        public string $journalId,
        public int $lockVersion,
        public DateTimeImmutable $date,
        public array $lines,
        public ?string $reference = null,
        public ?string $memo = null,
        public ?string $fiscalPeriodId = null,
    ) {}
}
