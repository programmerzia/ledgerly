<?php

declare(strict_types=1);

namespace App\Domain\Files;

/** Where a file is in the virus-scan pipeline (13 §17). Only `clean` content is ever served. */
enum ScanStatus: string
{
    case Pending = 'pending';
    case Clean = 'clean';
    case Infected = 'infected';
    case Error = 'error';
}
