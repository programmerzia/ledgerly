<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

/**
 * One journal line before posting. Amounts are base-currency minor units. For a foreign-currency
 * line, `currency`, `fxRate` (decimal string) and signed `amountFc` (+debit / −credit) are set.
 */
final readonly class DraftLine
{
    /** @param array<int, string|null> $dims position 1..8 → dimension_value id */
    public function __construct(
        public string $accountId,
        public int $debit = 0,
        public int $credit = 0,
        public ?string $currency = null,
        public ?string $fxRate = null,
        public ?int $amountFc = null,
        public array $dims = [],
        public ?string $description = null,
        public ?string $contactId = null,
        public ?string $taxCodeId = null,
        public ?string $dueDate = null,
    ) {}

    public function dim(int $position): ?string
    {
        return $this->dims[$position] ?? null;
    }

    /** Debits and credits swapped; fc amount negated (reversal mirror, 13 §9). */
    public function mirrored(): self
    {
        return new self(
            $this->accountId, $this->credit, $this->debit, $this->currency, $this->fxRate,
            $this->amountFc === null ? null : -$this->amountFc,
            $this->dims, $this->description, $this->contactId, $this->taxCodeId, $this->dueDate,
        );
    }
}
