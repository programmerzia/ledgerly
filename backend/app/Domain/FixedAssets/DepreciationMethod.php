<?php

declare(strict_types=1);

namespace App\Domain\FixedAssets;

enum DepreciationMethod: string
{
    case StraightLine = 'straight_line';
    case DecliningBalance = 'declining_balance';
    case UnitsOfProduction = 'units_of_production';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(static fn (self $m): string => $m->value, self::cases());
    }
}
