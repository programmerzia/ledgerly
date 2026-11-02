<?php

declare(strict_types=1);

namespace App\Domain\Imports;

/** A parsed upload: the header names and each non-blank data row as header => text, keyed by the row's number in the sheet. */
final readonly class ParsedSheet
{
    /**
     * @param  list<string>  $headers
     * @param  array<int, array<string, string>>  $rows  row number (header = 1) → cells by header
     */
    public function __construct(public string $format, public array $headers, public array $rows) {}
}
