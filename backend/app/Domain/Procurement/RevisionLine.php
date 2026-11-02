<?php

declare(strict_types=1);

namespace App\Domain\Procurement;

/** A line as a revision proposes it. A null id is a new line. */
final readonly class RevisionLine
{
    public function __construct(
        public int $lineNo,
        public ?string $id,
        public ?string $itemId,
        public string $quantity,
    ) {}
}
