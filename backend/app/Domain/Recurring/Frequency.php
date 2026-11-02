<?php

declare(strict_types=1);

namespace App\Domain\Recurring;

enum Frequency: string
{
    case Monthly = 'monthly';
    case Quarterly = 'quarterly';
    case Annual = 'annual';

    public function months(): int
    {
        return match ($this) {
            self::Monthly => 1,
            self::Quarterly => 3,
            self::Annual => 12,
        };
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $f): string => $f->value, self::cases());
    }
}
