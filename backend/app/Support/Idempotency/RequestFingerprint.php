<?php

declare(strict_types=1);

namespace App\Support\Idempotency;

use Illuminate\Http\Request;

/**
 * sha256(method ‖ path ‖ canonical query ‖ canonical body) (13 §11). JSON bodies are compared by
 * meaning, not bytes: object keys are sorted, so a client that re-serialises the same payload in a
 * different key order still matches its earlier attempt.
 */
final class RequestFingerprint
{
    public static function of(Request $request): string
    {
        $query = $request->query();
        $body = $request->isJson() ? $request->json()->all() : $request->getContent();

        return hash('sha256', implode("\n", [
            $request->method(),
            '/'.ltrim($request->path(), '/'),
            self::canonical($query),
            is_array($body) ? self::canonical($body) : (string) $body,
        ]));
    }

    private static function canonical(mixed $value): string
    {
        return (string) json_encode(self::sorted($value), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION);
    }

    private static function sorted(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value, SORT_STRING);
        }

        return array_map(self::sorted(...), $value);
    }
}
