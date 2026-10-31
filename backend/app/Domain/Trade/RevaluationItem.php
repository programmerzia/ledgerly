<?php

declare(strict_types=1);

namespace App\Domain\Trade;

final readonly class RevaluationItem
{
    public function __construct(
        public string $accountRef,
        public string $accountCode,
        public string $accountName,
        public string $currency,
        public int $amountFc,
        public string $currentRate,
        public int $unrealisedGainLoss,
    ) {}
}
