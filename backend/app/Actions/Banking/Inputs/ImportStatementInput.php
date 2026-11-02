<?php

declare(strict_types=1);

namespace App\Actions\Banking\Inputs;

final readonly class ImportStatementInput
{
    /** @param array<string, mixed> $mapping */
    public function __construct(
        public string $companyId,
        public string $bankAccountId,
        public string $content,
        public ?string $fileName,
        /** csv|ofx|camt|auto */
        public string $format = 'auto',
        public array $mapping = [],
        public bool $saveMapping = false,
        public ?int $openingBalance = null,
        public ?int $closingBalance = null,
    ) {}
}
