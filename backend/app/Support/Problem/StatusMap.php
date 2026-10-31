<?php

declare(strict_types=1);

namespace App\Support\Problem;

/** Domain error code → HTTP status (13 §5, §16). Unlisted domain codes are 422. */
final class StatusMap
{
    private const array MAP = [
        'version_conflict' => 409,
        'idempotency_in_progress' => 409,
        'self_approval_forbidden' => 403,
        'signature_required' => 403,
        'two_factor_required' => 403,
        'signing_locked' => 423,
        'tenant_read_only' => 423,
        'entitlement_exceeded' => 402,
        'rate_limited' => 429,
    ];

    public static function status(string $code): int
    {
        return self::MAP[$code] ?? 422;
    }
}
