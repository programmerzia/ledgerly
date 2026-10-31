<?php

declare(strict_types=1);

namespace App\Domain\Ledger;

enum DimensionRule: string
{
    case Required = 'required';
    case Optional = 'optional';
    case Forbidden = 'forbidden';
}
