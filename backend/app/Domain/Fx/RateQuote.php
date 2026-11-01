<?php

declare(strict_types=1);

namespace App\Domain\Fx;

/** A rate found for a date: `rate` is base units per 1 foreign unit, `date` the day it was struck for. */
final readonly class RateQuote
{
    public function __construct(
        public string $from,
        public string $to,
        public string $rate,
        public string $date,
        public string $source,
        /** True when only the opposite pair was stored and the rate is its reciprocal. */
        public bool $inverted = false,
    ) {}
}
