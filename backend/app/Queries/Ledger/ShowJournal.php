<?php

declare(strict_types=1);

namespace App\Queries\Ledger;

use App\Models\Ledger\Journal;

/** One journal with its lines, as every journal endpoint answers. */
final class ShowJournal
{
    public function __invoke(string $journalId): Journal
    {
        return Journal::query()->with('lines')->findOrFail($journalId);
    }
}
