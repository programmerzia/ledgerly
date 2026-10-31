<?php

declare(strict_types=1);

namespace App\Domain\Trade;

use App\Domain\Ledger\JournalType;

/** Output of a trade posting rule: a balanced set of lines plus header facts (13 §9). */
final readonly class ProposedJournal
{
    /** @param  list<ProposedLine>  $lines */
    public function __construct(
        public JournalType $journalType,
        public string $journalDate,
        public string $reference,
        public string $memo,
        public string $sourceType,
        public string $sourceId,
        public array $lines,
    ) {}

    public function totalDebit(): int
    {
        return array_sum(array_map(static fn (ProposedLine $l): int => $l->debit, $this->lines));
    }

    public function totalCredit(): int
    {
        return array_sum(array_map(static fn (ProposedLine $l): int => $l->credit, $this->lines));
    }
}
