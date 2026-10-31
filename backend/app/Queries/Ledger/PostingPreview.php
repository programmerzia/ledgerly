<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Domain\Shared\Violation;

/** What posting a draft would do, or why it cannot (13 §16 preview endpoint, 02 §5). */
final readonly class PostingPreview
{
    /** @param list<Violation> $violations */
    public function __construct(
        public bool $valid,
        public array $violations,
        public ?string $periodId,
        public ?string $periodName,
        public ?string $periodStatus,
        public int $totalDebit,
        public int $totalCredit,
    ) {}

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'valid' => $this->valid,
            'violations' => array_map(fn (Violation $v) => $v->toArray(), $this->violations),
            'period' => $this->periodId === null ? null : ['id' => $this->periodId, 'name' => $this->periodName, 'status' => $this->periodStatus],
            'total_debit' => $this->totalDebit,
            'total_credit' => $this->totalCredit,
            'number' => null, // assigned gaplessly at posting, never predicted (13 §9)
        ];
    }
}
