<?php

declare(strict_types=1);

namespace App\Domain\Trade;

final readonly class RevaluationInput
{
    /** @param  list<RevaluationItem>  $items */
    public function __construct(
        public string $id,
        public string $asOf,
        public array $items,
    ) {}
}
