<?php

declare(strict_types=1);

namespace App\Actions\Banking\Inputs;

final readonly class BankTransactionInput
{
    /** @param array<int, string> $dims position 1..8 → dimension value id (on the coding line) */
    public function __construct(
        public string $companyId,
        public string $statementLineId,
        /** spend|receive|transfer */
        public string $kind,
        public ?string $accountId = null,
        public ?string $toBankAccountId = null,
        public ?string $taxCodeId = null,
        public ?string $contactId = null,
        public array $dims = [],
        public ?string $memo = null,
        public ?string $ruleId = null,
    ) {}
}
