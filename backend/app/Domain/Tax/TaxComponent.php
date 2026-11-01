<?php

declare(strict_types=1);

namespace App\Domain\Tax;

use Brick\Math\BigRational;

/**
 * One tax applied to a line: a tax code at the rate in force on the document date. In a tax group the
 * components come in sequence; a `compound` component is charged on the net plus the taxes before it.
 */
final readonly class TaxComponent
{
    public BigRational $rate;

    /** @param  string  $rate  a fraction as a decimal string: "0.05" is 5% */
    public function __construct(public string $taxCodeId, string $rate, public bool $compound = false)
    {
        if (preg_match('/^\d+(\.\d+)?$/', $rate) !== 1) {
            throw new \InvalidArgumentException("Tax rate {$rate} is not a non-negative decimal string.");
        }
        $this->rate = BigRational::of($rate);
    }
}
