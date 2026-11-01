<?php

declare(strict_types=1);

namespace App\Contracts;

use App\Domain\Fx\ProviderRates;
use App\Support\Fx\RateProviderFailed;

/** A daily reference-rate feed (13 §15 scheduler). Adapters fetch over HTTP; tests bind a fake. */
interface ExchangeRateProvider
{
    /** Stable name for logs and audit, e.g. `ecb`. */
    public function name(): string;

    /** The latest published rates. @throws RateProviderFailed on any transport or format problem */
    public function latest(): ProviderRates;
}
