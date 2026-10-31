<?php

declare(strict_types=1);

namespace App\Domain\Trade;

final readonly class DepreciationLine
{
    public function __construct(
        public string $assetId,
        public string $assetNumber,
        public string $assetName,
        public int $amount,
    ) {}
}
