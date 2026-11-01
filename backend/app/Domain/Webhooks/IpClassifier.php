<?php

declare(strict_types=1);

namespace App\Domain\Webhooks;

/**
 * SSRF address classification (13 §15): which IP addresses a webhook may be delivered to. Only globally
 * routable unicast addresses pass. Everything else is named by the reason it is refused. IPv4-mapped
 * (::ffff:a.b.c.d) addresses are judged as the IPv4 address they carry; NAT64 and 6to4 are refused outright.
 */
final class IpClassifier
{
    /** @var list<array{string, int, string}> */
    private const array V4 = [
        ['0.0.0.0', 8, 'unspecified'],
        ['10.0.0.0', 8, 'private'],
        ['100.64.0.0', 10, 'carrier_grade_nat'],
        ['127.0.0.0', 8, 'loopback'],
        ['169.254.0.0', 16, 'link_local'],
        ['172.16.0.0', 12, 'private'],
        ['192.0.0.0', 24, 'reserved'],
        ['192.0.2.0', 24, 'documentation'],
        ['192.88.99.0', 24, 'reserved'],
        ['192.168.0.0', 16, 'private'],
        ['198.18.0.0', 15, 'benchmarking'],
        ['198.51.100.0', 24, 'documentation'],
        ['203.0.113.0', 24, 'documentation'],
        ['224.0.0.0', 4, 'multicast'],
        ['240.0.0.0', 4, 'reserved'],
    ];

    /** @var list<array{string, int, string}> */
    private const array V6 = [
        ['::', 96, 'unspecified'],            // ::, ::1 and the deprecated IPv4-compatible block
        ['64:ff9b::', 96, 'nat64'],
        ['64:ff9b:1::', 48, 'nat64'],
        ['100::', 64, 'reserved'],            // discard-only
        ['2001::', 23, 'reserved'],           // IETF assignments, Teredo, ORCHID
        ['2001:db8::', 32, 'documentation'],
        ['2002::', 16, 'six_to_four'],
        ['fc00::', 7, 'unique_local'],
        ['fe80::', 10, 'link_local'],
        ['fec0::', 10, 'reserved'],           // deprecated site-local
        ['ff00::', 8, 'multicast'],
    ];

    /** The reason $ip must not be contacted, or null when it is public. */
    public static function blockedReason(string $ip): ?string
    {
        $bin = inet_pton($ip);
        if ($bin === false) {
            return 'invalid';
        }
        if (strlen($bin) === 4) {
            return self::match($bin, self::V4);
        }
        if (str_starts_with($bin, str_repeat("\0", 10)."\xff\xff")) {
            return self::match(substr($bin, 12), self::V4);
        }

        return self::match($bin, self::V6);
    }

    public static function isPublic(string $ip): bool
    {
        return self::blockedReason($ip) === null;
    }

    /** @param list<array{string, int, string}> $table */
    private static function match(string $bin, array $table): ?string
    {
        foreach ($table as [$network, $bits, $reason]) {
            $net = inet_pton($network);
            if ($net !== false && self::inPrefix($bin, $net, $bits)) {
                return $reason;
            }
        }

        return null;
    }

    private static function inPrefix(string $bin, string $net, int $bits): bool
    {
        $bytes = intdiv($bits, 8);
        if ($bytes > 0 && substr($bin, 0, $bytes) !== substr($net, 0, $bytes)) {
            return false;
        }
        $rest = $bits % 8;
        if ($rest === 0) {
            return true;
        }
        $mask = (0xFF << (8 - $rest)) & 0xFF;

        return (ord($bin[$bytes]) & $mask) === (ord($net[$bytes]) & $mask);
    }
}
