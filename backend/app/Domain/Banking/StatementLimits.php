<?php

declare(strict_types=1);

namespace App\Domain\Banking;

/** Import is synchronous, so files are capped: bigger ones are refused, not queued (2.13). */
final class StatementLimits
{
    public const int MAX_BYTES = 2_097_152;

    public const int MAX_LINES = 5000;
}
