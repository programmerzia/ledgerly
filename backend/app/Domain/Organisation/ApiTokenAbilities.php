<?php

declare(strict_types=1);

namespace App\Domain\Organisation;

/**
 * The abilities an API token can carry: `<resource>:read|write|submit`, exactly the ones the policies check (13 §7).
 * There is no approve, return, reverse, void, close or sign ability and no wildcard: those are for people with a signing
 * PIN, so no token can be issued that could approve anything. Pure.
 */
final class ApiTokenAbilities
{
    /** @var list<string> */
    public const array ALL = [
        'accounts:read', 'accounts:write', 'attachments:read', 'attachments:write', 'banking:read', 'banking:write',
        'bills:read', 'bills:write', 'bills:submit', 'contacts:read', 'contacts:write', 'dimensions:read', 'dimensions:write',
        'fx:read', 'fx:write', 'invoices:read', 'invoices:write', 'invoices:submit', 'items:read', 'items:write',
        'journals:read', 'journals:write', 'journals:submit', 'periods:read', 'recurring:read', 'recurring:write',
        'reports:read', 'settlements:read', 'settlements:write', 'settlements:submit', 'tax:read',
    ];

    /**
     * @param  list<string>  $abilities
     * @return list<string> the ones that are not allowed
     */
    public static function unknown(array $abilities): array
    {
        return array_values(array_diff($abilities, self::ALL));
    }
}
