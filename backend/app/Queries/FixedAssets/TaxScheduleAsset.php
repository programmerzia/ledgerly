<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

/** One asset's tax schedule. `stoppedAfterYear` is set for a disposed asset: no allowance is given after the year of disposal (no balancing adjustment is calculated). */
final readonly class TaxScheduleAsset
{
    /** @param list<TaxScheduleYear> $years */
    public function __construct(
        public string $assetId,
        public string $number,
        public string $name,
        public string $className,
        public int $cost,
        public int $annualRateBp,
        public ?int $firstYearRateBp,
        public ?int $stoppedAfterYear,
        public array $years,
    ) {}
}
