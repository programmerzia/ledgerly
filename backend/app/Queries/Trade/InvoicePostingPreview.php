<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Domain\Ledger\DraftLine;
use App\Domain\Shared\Violation;

/** What posting a draft invoice, credit note, bill or debit note would do, or why it cannot (13 §9, 02 §6 "journal preview"). */
final readonly class InvoicePostingPreview
{
    /**
     * @param  list<Violation>  $violations
     * @param  list<DraftLine>  $lines  the journal that would be posted, in base and foreign amounts
     */
    public function __construct(
        public bool $valid,
        public array $violations,
        public ?string $periodId,
        public ?string $periodName,
        public ?string $periodStatus,
        public int $totalDebit,
        public int $totalCredit,
        public array $lines,
    ) {}
}
