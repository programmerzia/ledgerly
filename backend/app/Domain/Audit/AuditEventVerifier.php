<?php

declare(strict_types=1);

namespace App\Domain\Audit;

use Carbon\CarbonImmutable;
use JsonException;
use Throwable;

/**
 * The checks on one audit event, shared by the chain verification (`VerifyAuditChain`) and the tamper-evident export
 * (`AuditBundleVerifier`), so both judge an event by exactly the same rules (13 §14):
 *  - `hashMatches`: `hash` = sha256(prev_hash ‖ canonical), over the stored canonical text byte for byte;
 *  - `columnMismatch`: the canonical text decodes to the row's own columns (scalars, ip, occurred_at and the three
 *    JSON documents compared by their RFC 8785 form), so a column edited without touching the canonical text shows.
 */
final class AuditEventVerifier
{
    public const array SCALARS = [
        'tenant_id', 'company_id', 'actor_type', 'actor_id', 'action', 'subject_type', 'subject_id',
        'user_agent', 'request_id', 'prev_hash',
    ];

    public const array DOCUMENTS = ['before', 'after', 'context'];

    /** @param array<string, mixed> $row */
    public static function hashMatches(array $row, ?string $prev): bool
    {
        return hash_equals(self::text($row['hash'] ?? null), hash('sha256', ($prev ?? '').self::text($row['canonical'] ?? null)));
    }

    /**
     * The first column whose value differs from the canonical record, or null.
     *
     * @param  array<string, mixed>  $row
     */
    public static function columnMismatch(array $row): ?string
    {
        try {
            $canonical = json_decode(self::text($row['canonical']), true, 512, JSON_THROW_ON_ERROR);
            if (! is_array($canonical)) {
                return 'canonical';
            }
        } catch (JsonException) {
            return 'canonical';
        }

        foreach (self::SCALARS as $field) {
            if (($canonical[$field] ?? null) !== $row[$field]) {
                return $field;
            }
        }
        if (! self::sameIp($canonical['ip'] ?? null, $row['ip'])) {
            return 'ip';
        }
        try {
            $occurred = CarbonImmutable::parse(self::text($row['occurred_at']))->utc()->format('Y-m-d\TH:i:s.u\Z');
        } catch (Throwable) {
            return 'occurred_at';
        }
        if (($canonical['occurred_at'] ?? null) !== $occurred) {
            return 'occurred_at';
        }
        foreach (self::DOCUMENTS as $field) {
            try {
                $stored = $row[$field] === null ? null : json_decode(self::text($row[$field]), true, 512, JSON_THROW_ON_ERROR);
                if (Jcs::encode($stored) !== Jcs::encode($canonical[$field] ?? null)) {
                    return $field;
                }
            } catch (Throwable) {
                return $field;
            }
        }

        return null;
    }

    private static function text(mixed $value): string
    {
        return is_scalar($value) ? (string) $value : '';
    }

    /** inet output may spell an address differently from the input ("::1" vs "0:0:…:1"). */
    private static function sameIp(mixed $canonical, mixed $stored): bool
    {
        if ($canonical === null || $stored === null) {
            return $canonical === $stored;
        }

        return @inet_pton(self::text($canonical)) === @inet_pton(self::text($stored));
    }
}
