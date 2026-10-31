<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

enum CurrencyPolicy: string
{
    case BaseOnly = 'base_only';
    case Any = 'any';
    case Fixed = 'fixed';
}
