<?php

declare(strict_types=1);

namespace App\Actions\Fx\Inputs;

final readonly class ExchangeRateInput
{
    public function __construct(
        public string $companyId,
        public string $fromCurrency,
        public string $toCurrency,
        /** YYYY-MM-DD */
        public string $rateDate,
        /** Exact decimal string, base units per 1 unit of $fromCurrency, at most 8 decimals. */
        public string $rate,
    ) {}
}
