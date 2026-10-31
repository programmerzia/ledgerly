<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

use App\Domain\Fiscal\PeriodKind;
use App\Domain\Fiscal\PeriodStatus;
use DateTimeImmutable;

final readonly class PeriodInfo
{
    public function __construct(
        public string $id,
        public PeriodStatus $status,
        public PeriodKind $kind,
        public DateTimeImmutable $startsOn,
        public DateTimeImmutable $endsOn,
    ) {}

    public function contains(DateTimeImmutable $date): bool
    {
        $d = $date->format('Y-m-d');

        return $d >= $this->startsOn->format('Y-m-d') && $d <= $this->endsOn->format('Y-m-d');
    }
}
