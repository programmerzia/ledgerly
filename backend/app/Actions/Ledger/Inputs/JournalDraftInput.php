<?php

declare(strict_types=1);

namespace App\Actions\Ledger\Inputs;

use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use DateTimeImmutable;

final readonly class JournalDraftInput
{
    /** @param list<DraftLine> $lines */
    public function __construct(
        public string $companyId,
        public JournalType $type,
        public DateTimeImmutable $date,
        public array $lines,
        public ?string $reference = null,
        public ?string $memo = null,
        /** Required for closing/adjustment journals: the adjustment period (D7). */
        public ?string $fiscalPeriodId = null,
        /** Client-generated UUIDv7, accepted if unused (13 §12). */
        public ?string $id = null,
        /** The document this journal belongs to (a bank transaction), if any. */
        public ?string $sourceType = null,
        public ?string $sourceId = null,
    ) {}
}
