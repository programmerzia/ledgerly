<?php

declare(strict_types=1);

namespace App\Events\Ledger;

use App\Contracts\OutboxEvent;

final readonly class JournalReversed implements OutboxEvent
{
    public function __construct(public string $journalId, public string $companyId, public string $reversalId, public int $version) {}

    public function type(): string
    {
        return 'journal.reversed';
    }

    public function payload(): array
    {
        return ['journal_id' => $this->journalId, 'company_id' => $this->companyId, 'reversal_id' => $this->reversalId, 'version' => $this->version];
    }
}
