<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

/**
 * `X-Ledgerly-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>` (13 §15).
 * The timestamp is inside the signed text, so a captured request cannot be replayed with a fresh `t`;
 * receivers also reject a `t` older than their tolerance.
 */
final class WebhookSigner
{
    public const string HEADER = 'X-Ledgerly-Signature';

    public const int DEFAULT_TOLERANCE = 300;

    public static function header(string $secret, int $timestamp, string $body): string
    {
        return "t={$timestamp},v1=".hash_hmac('sha256', "{$timestamp}.{$body}", $secret);
    }

    /** What a receiver does: recompute, compare in constant time, and refuse stale timestamps. */
    public static function verify(string $header, string $body, string $secret, int $now, int $tolerance = self::DEFAULT_TOLERANCE): bool
    {
        $timestamp = null;
        $signatures = [];
        foreach (explode(',', $header) as $part) {
            [$key, $value] = array_pad(explode('=', trim($part), 2), 2, '');
            if ($key === 't' && ctype_digit($value)) {
                $timestamp = (int) $value;
            } elseif ($key === 'v1') {
                $signatures[] = $value;
            }
        }
        if ($timestamp === null || $signatures === [] || abs($now - $timestamp) > $tolerance) {
            return false;
        }
        $expected = hash_hmac('sha256', "{$timestamp}.{$body}", $secret);
        foreach ($signatures as $signature) {
            if (hash_equals($expected, $signature)) {
                return true;
            }
        }

        return false;
    }

    /** A fresh signing secret, shown to the owner once. */
    public static function newSecret(): string
    {
        return 'whsec_'.rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }
}
