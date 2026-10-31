<?php

declare(strict_types=1);

namespace App\Domain\Audit;

use InvalidArgumentException;

/**
 * RFC 8785 JSON Canonicalization Scheme for the values audit events carry: null, bool, int,
 * string, list and string-keyed map. Floats are rejected (money and rates are ints or strings).
 * Integers outside ±2^53 are emitted as strings so every JSON reader agrees on them (13 §14).
 */
final class Jcs
{
    private const int SAFE_INT = 9007199254740991;

    public static function encode(mixed $value): string
    {
        return match (true) {
            $value === null => 'null',
            is_bool($value) => $value ? 'true' : 'false',
            is_int($value) => abs($value) > self::SAFE_INT ? self::string((string) $value) : (string) $value,
            is_string($value) => self::string($value),
            is_array($value) => array_is_list($value) ? self::list($value) : self::map($value),
            default => throw new InvalidArgumentException('JCS: unsupported type '.get_debug_type($value)),
        };
    }

    private static function string(string $value): string
    {
        $json = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR);

        return $json;
    }

    /** @param list<mixed> $value */
    private static function list(array $value): string
    {
        return '['.implode(',', array_map(self::encode(...), $value)).']';
    }

    /** @param array<array-key, mixed> $value */
    private static function map(array $value): string
    {
        $keys = array_map('strval', array_keys($value));
        // RFC 8785 §3.2.3: sort by UTF-16 code units.
        usort($keys, fn (string $a, string $b) => strcmp(self::utf16($a), self::utf16($b)));

        $parts = [];
        foreach ($keys as $key) {
            $parts[] = self::string($key).':'.self::encode($value[$key]);
        }

        return '{'.implode(',', $parts).'}';
    }

    private static function utf16(string $s): string
    {
        return (string) mb_convert_encoding($s, 'UTF-16BE', 'UTF-8');
    }
}
