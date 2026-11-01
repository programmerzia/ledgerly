<?php

declare(strict_types=1);

namespace App\Domain\Tax;

/**
 * A document line for tax purposes. `$amount` is in integer minor units of the document currency: the net
 * when prices are tax-exclusive, the gross (tax included) when `$inclusive`. Credit lines may be negative.
 */
final readonly class TaxLine
{
    /** @param  list<TaxComponent>  $components  in sequence; empty for an untaxed line */
    public function __construct(public int $amount, public array $components = [], public bool $inclusive = false) {}
}
