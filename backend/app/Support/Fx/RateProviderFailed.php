<?php

declare(strict_types=1);

namespace App\Support\Fx;

use RuntimeException;

/** The provider could not be reached or answered something unusable. Callers log it and keep the rates they have. */
final class RateProviderFailed extends RuntimeException {}
