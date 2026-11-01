<?php

declare(strict_types=1);

namespace App\Domain\Tax;

/** The tax result of one line, in integer minor units. `net + tax = gross`. */
final readonly class LineTax
{
    /** @param  array<string, int>  $byCode  tax code id → this line's share of that code's tax */
    public function __construct(public int $net, public int $tax, public int $gross, public array $byCode) {}
}
