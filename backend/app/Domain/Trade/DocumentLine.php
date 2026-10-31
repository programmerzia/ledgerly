<?php

declare(strict_types=1);

namespace App\Domain\Trade;

/** A priced invoice or bill line; lineTotalFc is already net of discount. */
final readonly class DocumentLine
{
    /** @param  array<string, string>  $dimensions */
    public function __construct(
        public string $id,
        public string $accountRef,
        public string $description,
        public int $lineTotalFc,
        public array $dimensions,
        public ?string $taxCodeRef = null,
    ) {}
}
