<?php

declare(strict_types=1);

namespace App\Actions\Ledger\Inputs;

final readonly class PostJournalInput
{
    public function __construct(public string $journalId, public ?int $lockVersion = null) {}
}
