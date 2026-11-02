<?php

declare(strict_types=1);

namespace App\Actions\Imports\Inputs;

use App\Domain\Imports\ParsedSheet;

final readonly class CreateImportInput
{
    /** @param array<string, mixed> $options */
    public function __construct(
        public string $companyId,
        public string $kind,
        public ParsedSheet $sheet,
        public ?string $sourceName,
        public array $options = [],
    ) {}
}
