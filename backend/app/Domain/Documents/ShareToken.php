<?php

declare(strict_types=1);

namespace App\Domain\Documents;

/**
 * The secret in an online invoice link (plan 3c.7b): 32 random bytes (256 bits) from the system's CSPRNG, written as 43 URL-safe
 * characters. Only its SHA-256 is ever stored. A string that is not exactly that shape is rejected before any lookup.
 */
final class ShareToken
{
    public const int BYTES = 32;

    public const int LENGTH = 43;

    public static function generate(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(self::BYTES)), '+/', '-_'), '=');
    }

    public static function wellFormed(string $token): bool
    {
        return strlen($token) === self::LENGTH && preg_match('/^[A-Za-z0-9_-]{43}$/D', $token) === 1;
    }

    /** Lowercase hex SHA-256, 64 characters. */
    public static function hash(string $token): string
    {
        return hash('sha256', $token);
    }
}
