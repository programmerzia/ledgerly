<?php

declare(strict_types=1);

namespace App\Domain\Webhooks;

use DateTimeImmutable;

/**
 * When a failed webhook delivery is tried again (13 §15): exponential back-off from one minute,
 * each wait capped at four hours, ±20 % jitter, and the last attempt lands exactly at the end of the
 * window (24 h after the first attempt). After that the delivery gives up and the endpoint is auto-disabled.
 */
final class RetrySchedule
{
    public const int BASE_SECONDS = 60;

    public const int CAP_SECONDS = 14_400;

    public const float JITTER = 0.2;

    /** Seconds to wait after the $attempts-th failed attempt, before jitter. */
    public static function baseDelay(int $attempts): int
    {
        return min(self::BASE_SECONDS * (1 << min(max($attempts - 1, 0), 20)), self::CAP_SECONDS);
    }

    /**
     * @param  float  $jitter  a random number in [0, 1)
     * @return DateTimeImmutable|null the next attempt, or null when the window is over
     */
    public static function nextAttempt(DateTimeImmutable $windowStart, DateTimeImmutable $now, int $attempts, int $windowSeconds, float $jitter): ?DateTimeImmutable
    {
        $deadline = $windowStart->modify("+{$windowSeconds} seconds");
        if ($now >= $deadline) {
            return null;
        }
        $delay = (int) round(self::baseDelay($attempts) * (1 + ($jitter * 2 - 1) * self::JITTER));
        $next = $now->modify('+'.max($delay, 1).' seconds');

        return $next > $deadline ? $deadline : $next;
    }
}
