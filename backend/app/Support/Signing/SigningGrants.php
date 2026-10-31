<?php

declare(strict_types=1);

namespace App\Support\Signing;

use App\Contracts\Clock;
use App\Domain\Signing\PinPolicy;
use Illuminate\Contracts\Cache\Repository as Cache;

/**
 * A verified PIN yields a short-lived grant bound to the user AND the session (ADR-0004), kept
 * server-side in the cache store (Redis in production). Signature-requiring Actions check it
 * through `Actor::hasSigningGrant`; the SPA never holds the PIN or a token for it.
 */
final class SigningGrants
{
    public function __construct(private readonly Cache $cache, private readonly Clock $clock) {}

    public function grant(string $userId, string $sessionId): void
    {
        $this->cache->put(self::key($userId, $sessionId), $this->clock->now()->format(DATE_RFC3339_EXTENDED), PinPolicy::GRANT_MINUTES * 60);
    }

    public function has(string $userId, string $sessionId): bool
    {
        return $this->cache->has(self::key($userId, $sessionId));
    }

    public function revoke(string $userId, string $sessionId): void
    {
        $this->cache->forget(self::key($userId, $sessionId));
    }

    private static function key(string $userId, string $sessionId): string
    {
        return 'sign:'.$userId.':'.hash('sha256', $sessionId);
    }
}
