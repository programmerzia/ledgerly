<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;

/** Comparison columns: the earlier amount, the difference and the difference as a percentage of the earlier amount. */
final class Variance
{
    /**
     * @return array{comparison: array{amount: int, currency: string}, variance: array{amount: int, currency: string}, variance_pct: string|null}
     */
    public static function of(int $current, int $previous, string $currency): array
    {
        return [
            'comparison' => Json::money($previous, $currency),
            'variance' => Json::money($current - $previous, $currency),
            'variance_pct' => self::pct($current - $previous, $previous),
        ];
    }

    /** One decimal, computed in integers (HALF_UP on the absolute value); null when there is nothing to divide by. */
    public static function pct(int $variance, int $base): ?string
    {
        if ($base === 0) {
            return null;
        }
        $tenths = intdiv(abs($variance) * 2000 + abs($base), 2 * abs($base));   // round(|v| / |b| * 1000)
        // The sign is the sign of the change itself, measured against |base|.
        $sign = $variance < 0 && $tenths !== 0 ? '-' : '';

        return $sign.intdiv($tenths, 10).'.'.($tenths % 10);
    }
}
