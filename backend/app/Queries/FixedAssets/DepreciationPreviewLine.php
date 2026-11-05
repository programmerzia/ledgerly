<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

/** One asset in a depreciation preview. `catchUpMonths` is how many of the months are from earlier periods that were skipped. */
final readonly class DepreciationPreviewLine
{
    public function __construct(
        public string $assetId,
        public string $assetNumber,
        public string $assetName,
        public string $categoryName,
        public string $method,
        public int $months,
        public int $catchUpMonths,
        public int $amount,
        public int $units,
        public int $carryingBefore,
        public int $carryingAfter,
    ) {}
}
