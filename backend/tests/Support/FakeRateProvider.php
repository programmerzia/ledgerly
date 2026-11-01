<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Contracts\ExchangeRateProvider;
use App\Domain\Fx\ProviderRates;
use App\Support\Fx\RateProviderFailed;

/** A rate provider that never touches the network: serves canned rates, or fails on demand. */
final class FakeRateProvider implements ExchangeRateProvider
{
    public int $calls = 0;

    public bool $fail = false;

    /** @param array<string, string> $rates EUR-based */
    public function __construct(public ProviderRates $rates = new ProviderRates('2026-03-31', 'EUR', ['USD' => '1.25000000', 'GBP' => '0.80000000', 'JPY' => '160.00'])) {}

    public function name(): string
    {
        return 'fake';
    }

    public function latest(): ProviderRates
    {
        $this->calls++;

        return $this->fail ? throw new RateProviderFailed('fake outage') : $this->rates;
    }
}
