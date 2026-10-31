<?php

declare(strict_types=1);

namespace App\Domain\Fiscal;

use DateTimeImmutable;

final readonly class PlannedPeriod
{
    public function __construct(
        public int $number,
        public string $name,
        public DateTimeImmutable $startsOn,
        public DateTimeImmutable $endsOn,
        public PeriodKind $kind,
    ) {}
}
