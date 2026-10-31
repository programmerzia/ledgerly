<?php

declare(strict_types=1);

namespace App\Domain\Trade;

final readonly class DepreciationInput
{
    /** @param  list<DepreciationLine>  $lines */
    public function __construct(
        public string $id,
        public string $asOf,
        public string $expenseAccountRef,
        public string $accumulatedAccountRef,
        public array $lines,
    ) {}
}
