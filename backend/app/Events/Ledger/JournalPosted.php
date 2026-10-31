<?php

declare(strict_types=1);

namespace App\Events\Ledger;

use App\Contracts\OutboxEvent;

final readonly class JournalPosted implements OutboxEvent
{
    public function __construct(public string $journalId, public string $companyId, public string $number, public int $version) {}

    public function type(): string
    {
        return 'journal.posted';
    }

    public function payload(): array
    {
        return ['journal_id' => $this->journalId, 'company_id' => $this->companyId, 'number' => $this->number, 'version' => $this->version];
    }
}
