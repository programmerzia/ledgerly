<?php

declare(strict_types=1);

namespace App\Domain\Fx;

/** One day's reference rates as a provider publishes them: units of each currency per 1 unit of `base`. */
final readonly class ProviderRates
{
    /** @param array<string, string> $rates currency code → exact decimal string; the base itself is implicit (1) */
    public function __construct(public string $date, public string $base, public array $rates) {}

    /** Units of $currency per 1 unit of the base, or null when the provider does not quote it. */
    public function perBase(string $currency): ?string
    {
        return $currency === $this->base ? '1' : ($this->rates[$currency] ?? null);
    }
}
