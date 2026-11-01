<?php

declare(strict_types=1);

namespace App\Actions\Tax\Inputs;

use DateTimeImmutable;

final readonly class TaxRateInput
{
    /** @param  string  $rate  a fraction as a decimal string, "0.05" = 5% */
    public function __construct(public string $rate, public DateTimeImmutable $effectiveFrom, public ?DateTimeImmutable $effectiveTo = null) {}
}
