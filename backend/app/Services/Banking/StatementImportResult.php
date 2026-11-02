<?php

declare(strict_types=1);

namespace App\Services\Banking;

use App\Models\Banking\BankStatement;

/** What an import did, for the response. */
final readonly class StatementImportResult
{
    /** @param list<string> $warnings */
    public function __construct(
        public ?BankStatement $statement,
        public int $linesImported,
        public int $duplicateLinesSkipped,
        public bool $alreadyImported,
        public array $warnings,
    ) {}
}
