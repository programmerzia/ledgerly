<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

final readonly class TaxScheduleYear
{
    public function __construct(public int $year, public string $label, public int $allowance, public int $writtenDown) {}
}
