<?php

declare(strict_types=1);

namespace App\Domain\Tax;

use DateTimeImmutable;

/** A rate of a tax code in force from `$from` to `$to` inclusive (null: open-ended). */
final readonly class TaxRatePeriod
{
    /** @param  string  $rate  a fraction as a decimal string: "0.05" is 5% */
    public function __construct(public string $rate, public DateTimeImmutable $from, public ?DateTimeImmutable $to = null) {}

    public function covers(DateTimeImmutable $date): bool
    {
        $day = $date->format('Y-m-d');

        return $this->from->format('Y-m-d') <= $day && ($this->to === null || $day <= $this->to->format('Y-m-d'));
    }

    public function overlaps(self $other): bool
    {
        return ($this->to === null || $other->from->format('Y-m-d') <= $this->to->format('Y-m-d'))
            && ($other->to === null || $this->from->format('Y-m-d') <= $other->to->format('Y-m-d'));
    }
}
