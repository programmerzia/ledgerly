<?php

declare(strict_types=1);

namespace App\Domain\Banking;

/** One statement line. `amount` is signed minor units: money in is positive. */
final readonly class ParsedLine
{
    public function __construct(
        /** YYYY-MM-DD */
        public string $txnDate,
        public int $amount,
        public string $description,
        public ?string $valueDate = null,
        public ?string $reference = null,
        public ?string $counterparty = null,
        public ?int $balanceAfter = null,
        /** Line number (CSV, SGML) or entry number in the file. */
        public int $sourceLine = 0,
    ) {}
}
