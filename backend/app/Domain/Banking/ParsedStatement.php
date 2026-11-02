<?php

declare(strict_types=1);

namespace App\Domain\Banking;

/** What a parser found in a file. Balances are null when the file does not state them. */
final readonly class ParsedStatement
{
    /**
     * @param  list<ParsedLine>  $lines
     * @param  list<string>  $warnings
     */
    public function __construct(
        public string $format,
        public array $lines,
        public ?int $openingBalance = null,
        public ?int $closingBalance = null,
        public ?string $periodFrom = null,
        public ?string $periodTo = null,
        public ?string $currency = null,
        public ?string $accountId = null,
        public array $warnings = [],
    ) {}

    public function sum(): int
    {
        return array_sum(array_map(fn (ParsedLine $l): int => $l->amount, $this->lines));
    }
}
