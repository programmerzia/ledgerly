<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

/** sha256 of the eight dimension values, nulls as empty (13 §9); raw 32 bytes. */
final class DimKey
{
    /** @param array<int, string|null> $dims */
    public static function of(array $dims): string
    {
        $parts = [];
        for ($p = 1; $p <= 8; $p++) {
            $parts[] = $dims[$p] ?? '';
        }

        return hash('sha256', implode('|', $parts), true);
    }
}
