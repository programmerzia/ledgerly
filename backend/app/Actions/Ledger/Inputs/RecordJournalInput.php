<?php

declare(strict_types=1);

namespace App\Actions\Ledger\Inputs;

use App\Domain\Ledger\JournalDraft;

/** A system-built journal (posting rules, revaluation, year-end) to create and post at once. */
final readonly class RecordJournalInput
{
    public function __construct(
        public JournalDraft $draft,
        public ?string $fiscalPeriodId = null,
        public ?string $id = null,
    ) {}
}
