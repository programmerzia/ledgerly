<?php

declare(strict_types=1);

namespace App\Contracts;

use DateTimeImmutable;

/** Source of "now" for Actions and Domain code (13 §8). Never call now() in business code. */
interface Clock
{
    public function now(): DateTimeImmutable;
}
