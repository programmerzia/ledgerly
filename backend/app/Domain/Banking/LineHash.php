<?php

declare(strict_types=1);

namespace App\Domain\Banking;

/**
 * The deterministic identity of a statement line (05 §10: unique per bank account). Same account, date, amount,
 * description and reference give the same hash; genuinely identical lines in one file are told apart by their
 * occurrence number (1st, 2nd, ...) in file order, so importing the same file twice adds nothing.
 */
final class LineHash
{
    /**
     * @param  list<ParsedLine>  $lines
     * @return list<string> one hash per line, in order
     */
    public static function all(string $bankAccountId, array $lines): array
    {
        $seen = [];
        $out = [];
        foreach ($lines as $l) {
            $key = implode("\x1f", [$bankAccountId, $l->txnDate, (string) $l->amount, self::norm($l->description), self::norm($l->reference ?? '')]);
            $seen[$key] = ($seen[$key] ?? 0) + 1;
            $out[] = hash('sha256', $key."\x1f".$seen[$key]);
        }

        return $out;
    }

    private static function norm(string $s): string
    {
        return mb_strtolower(trim((string) preg_replace('/\s+/u', ' ', $s)));
    }
}
