<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Domain\Ledger\JournalStatus;
use App\Domain\Ledger\JournalType;

/** What the journal list can be narrowed by; every field is optional. */
final readonly class JournalFilter
{
    public function __construct(
        public ?JournalStatus $status = null,
        public ?JournalType $type = null,
        public ?string $from = null,
        public ?string $to = null,
        public ?string $periodId = null,
        /** Matches the number or the reference, case-insensitively. */
        public ?string $search = null,
    ) {}
}
