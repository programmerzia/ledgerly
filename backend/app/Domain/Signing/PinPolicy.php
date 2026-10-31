<?php

declare(strict_types=1);

namespace App\Domain\Signing;

/** What counts as an acceptable signing PIN (ADR-0004): six digits that are not trivially guessable. */
final class PinPolicy
{
    public const int LENGTH = 6;

    public const int MAX_FAILURES = 3;

    public const int LOCKOUT_MINUTES = 15;

    public const int GRANT_MINUTES = 10;

    /** @return list<string> violation codes; empty when the PIN is acceptable */
    public static function violations(string $pin): array
    {
        if (! preg_match('/^\d{'.self::LENGTH.'}$/', $pin)) {
            return ['pin_format'];
        }
        $digits = array_map(intval(...), str_split($pin));
        if (count(array_unique($digits)) === 1) {
            return ['pin_repeated'];
        }
        $steps = [];
        for ($i = 1; $i < count($digits); $i++) {
            $steps[] = $digits[$i] - $digits[$i - 1];
        }
        if (count(array_unique($steps)) === 1 && abs($steps[0]) === 1) {
            return ['pin_sequential'];
        }

        return [];
    }
}
